import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';
import type { FeatureChild } from '@cucumber/messages';

const textDecoder = new TextDecoder('utf-8');

export type TestData = TestFile | TestCase;

export const testData = new WeakMap<vscode.TestItem, TestData>();

let generationCounter = 0;
let gherkinIdCounter = 0;

export const getContentFromFilesystem = async (uri: vscode.Uri) => {
  try {
    const rawContent = await vscode.workspace.fs.readFile(uri);
    return textDecoder.decode(rawContent);
  } catch (e) {
    console.warn(`Error providing tests for ${uri.fsPath}`, e);
    return '';
  }
};

function parseGherkinDocument(content: string) {
  const matcher = new GherkinClassicTokenMatcher();
  const parser = new Parser(new AstBuilder(() => String(gherkinIdCounter++)), matcher);
  try {
    return parser.parse(content);
  } catch {
    return null;
  }
}

export class TestFile {
  public didResolve = false;

  public async updateFromDisk(controller: vscode.TestController, item: vscode.TestItem) {
    try {
      const content = await getContentFromFilesystem(item.uri!);
      item.error = undefined;
      this.updateFromContents(controller, content, item);
    } catch (e) {
      item.error = (e as Error).stack;
    }
  }

  public updateFromContents(controller: vscode.TestController, content: string, item: vscode.TestItem) {
    const thisGeneration = generationCounter++;
    this.didResolve = true;

    const doc = parseGherkinDocument(content);
    if (!doc?.feature) {
      item.children.replace([]);
      return;
    }

    const { feature } = doc;
    const featureLine = feature.location.line - 1;
    const featureItem = controller.createTestItem(`${item.uri}/feature`, feature.name || 'Feature', item.uri);
    featureItem.range = new vscode.Range(featureLine, 0, featureLine, 0);
    featureItem.children.replace(buildScenarioItems(controller, feature.children, item, thisGeneration));
    item.children.replace([featureItem]);
  }
}

function buildScenarioItems(
  controller: vscode.TestController,
  children: readonly FeatureChild[],
  fileItem: vscode.TestItem,
  generation: number
): vscode.TestItem[] {
  const items: vscode.TestItem[] = [];

  for (const child of children) {
    if (child.rule) {
      const { rule } = child;
      const ruleLine = rule.location.line - 1;
      const ruleItem = controller.createTestItem(`${fileItem.uri}/${ruleLine}`, rule.name || 'Rule', fileItem.uri);
      ruleItem.range = new vscode.Range(ruleLine, 0, ruleLine, 0);
      ruleItem.children.replace(buildScenarioItems(controller, rule.children, fileItem, generation));
      items.push(ruleItem);
      continue;
    }

    const { scenario } = child;
    if (!scenario) continue;

    const scenarioLine = scenario.location.line;

    if (scenario.examples.length === 0) {
      const scenarioItem = createLeafItem(controller, fileItem, `${fileItem.uri}/${scenarioLine}`, scenario.name, scenarioLine, generation);
      items.push(scenarioItem);
    } else {
      // Scenario Outline: parent runs all rows; each child runs its own row
      const outlineItem = createLeafItem(controller, fileItem, `${fileItem.uri}/${scenarioLine}`, scenario.name, scenarioLine, generation);

      const exampleItems: vscode.TestItem[] = [];
      for (const examples of scenario.examples) {
        const headers = (examples.tableHeader?.cells ?? []).map(c => c.value);
        for (const row of examples.tableBody) {
          const interpolatedName = headers.reduce(
            (name, header, i) => name.replace(`<${header}>`, row.cells[i]?.value ?? ''),
            scenario.name
          );
          const exampleItem = createLeafItem(
            controller, fileItem,
            `${fileItem.uri}/${scenarioLine}/${row.location.line}`,
            interpolatedName, row.location.line, generation
          );
          exampleItems.push(exampleItem);
        }
      }
      outlineItem.children.replace(exampleItems);
      items.push(outlineItem);
    }
  }

  return items;
}

function createLeafItem(
  controller: vscode.TestController,
  fileItem: vscode.TestItem,
  id: string,
  name: string,
  gherkinLine: number,
  generation: number
): vscode.TestItem {
  const data = new TestCase(name, fileItem.uri?.fsPath as string, generation);
  const item = controller.createTestItem(id, name, fileItem.uri);
  testData.set(item, data);
  item.range = new vscode.Range(gherkinLine - 1, 0, gherkinLine - 1, 0);
  return item;
}

export class TestCase {
  constructor(
    private readonly testName: string,
    private readonly testUri: string,
    public generation: number
  ) { }

  getLabel() {
    return this.testName;
  }

  get namePattern() {
    return `^${this.testName
      .replace(/[-[\]{}()*+?.,^$|\\]/g, '\\$&')
      .replace(/<[^>]+>/g, '.+?')}$`;
  }

  async run(item: vscode.TestItem, options: vscode.TestRun): Promise<void> {
    const config = vscode.workspace.getConfiguration('qavajs');
    const launchCommand: string = config.get('launchCommand') ?? 'npx qavajs run';
    const command = `${launchCommand} --paths "${this.testUri}" --name "${this.namePattern}" --format summary`;
    options.appendOutput(`${command}\r\n`);
    return new Promise(resolve => {
      const shell = platform() === 'win32' ? 'powershell.exe' : '/bin/sh';
      const cwd = (vscode.workspace.workspaceFolders as any)[0].uri.fsPath;
      const child = spawn(command, { cwd, shell, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';

      child.stdout!.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        options.appendOutput(text.replace(/\r?\n/g, '\r\n'));
      });

      child.stderr!.on('data', (chunk: Buffer) => {
        options.appendOutput(chunk.toString().replace(/\r?\n/g, '\r\n'));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          options.failed(item, new vscode.TestMessage(stdout.split('Failures:')[1]?.trim() ?? stdout));
        } else if (/scenarios? \(\d+ passed\)/.test(stdout)) {
          options.passed(item);
        } else if (stdout.includes('0 scenarios')) {
          options.skipped(item);
        } else {
          options.failed(item, new vscode.TestMessage(stdout.split('Failures:')[1]?.trim() ?? stdout));
        }
        resolve();
      });

      options.token.onCancellationRequested(() => child.kill());
    });
  }
}
