import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';
import type { FeatureChild } from '@cucumber/messages';

const textDecoder = new TextDecoder('utf-8');

export type TestData = TestFile | TestFeature | TestCase;

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
    testData.set(featureItem, new TestFeature(item.uri!.fsPath, thisGeneration));
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

function runCucumber(
  command: string,
  options: vscode.TestRun,
  resolveItem: (line: number) => vscode.TestItem | undefined
): Promise<void> {
  options.appendOutput(`${command}\r\n`);
  return new Promise(resolve => {
    const shell = platform() === 'win32' ? 'powershell.exe' : '/bin/sh';
    const cwd = (vscode.workspace.workspaceFolders as any)[0].uri.fsPath;
    const proc = spawn(command, { cwd, shell, stdio: ['ignore', 'pipe', 'pipe'] });

    const astNodeLines = new Map<string, number>();
    const pickleLines = new Map<string, number>();
    const testCasePickles = new Map<string, string>();
    const startedCases = new Map<string, string>();
    const caseStepResults = new Map<string, { status: string; message?: string }[]>();

    let buffer = '';

    const processEnvelope = (raw: string) => {
      if (!raw.trim()) return;
      let envelope: any;
      try { envelope = JSON.parse(raw); } catch { return; }

      if (envelope.gherkinDocument?.feature) {
        const walk = (children: any[]) => {
          for (const child of children ?? []) {
            if (child.scenario) {
              astNodeLines.set(child.scenario.id, child.scenario.location.line);
              for (const ex of child.scenario.examples ?? []) {
                for (const row of ex.tableBody ?? []) {
                  astNodeLines.set(row.id, row.location.line);
                }
              }
            }
            if (child.rule) walk(child.rule.children ?? []);
          }
        };
        walk(envelope.gherkinDocument.feature.children ?? []);
      }

      if (envelope.pickle) {
        const { id, astNodeIds } = envelope.pickle;
        // For outline rows the last astNodeId is the row; for plain scenarios it's the scenario node
        for (let i = astNodeIds.length - 1; i >= 0; i--) {
          const line = astNodeLines.get(astNodeIds[i]);
          if (line !== undefined) { pickleLines.set(id, line); break; }
        }
      }

      if (envelope.testCase) {
        testCasePickles.set(envelope.testCase.id, envelope.testCase.pickleId);
      }

      if (envelope.testCaseStarted) {
        const { id, testCaseId } = envelope.testCaseStarted;
        startedCases.set(id, testCaseId);
        caseStepResults.set(id, []);
        const line = pickleLines.get(testCasePickles.get(testCaseId) ?? '');
        const item = line !== undefined ? resolveItem(line) : undefined;
        if (item) options.started(item);
      }

      if (envelope.testStepFinished) {
        const { testCaseStartedId, testStepResult } = envelope.testStepFinished;
        caseStepResults.get(testCaseStartedId)?.push({
          status: testStepResult.status,
          message: testStepResult.message
        });
      }

      if (envelope.testCaseFinished) {
        const { testCaseStartedId } = envelope.testCaseFinished;
        const pickleId = testCasePickles.get(startedCases.get(testCaseStartedId) ?? '');
        const line = pickleLines.get(pickleId ?? '');
        const item = line !== undefined ? resolveItem(line) : undefined;
        if (item) {
          const steps = caseStepResults.get(testCaseStartedId) ?? [];
          const worst = worstStepStatus(steps.map(s => s.status));
          if (worst === 'PASSED') {
            options.passed(item);
          } else if (worst === 'SKIPPED' || worst === 'PENDING') {
            options.skipped(item);
          } else {
            const msg = steps.find(s => s.status === worst)?.message?.trim()
              ?? `Scenario failed: ${worst}`;
            options.failed(item, new vscode.TestMessage(msg));
          }
        }
      }

    };

    proc.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(processEnvelope);
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      options.appendOutput(chunk.toString().replace(/\r?\n/g, '\r\n'));
    });

    proc.on('close', () => {
      processEnvelope(buffer);
      resolve();
    });

    options.token.onCancellationRequested(() => proc.kill());
  });
}

function worstStepStatus(statuses: string[]): string {
  for (const s of ['FAILED', 'AMBIGUOUS', 'UNDEFINED', 'PENDING', 'SKIPPED', 'PASSED']) {
    if (statuses.includes(s)) return s;
  }
  return statuses[0] ?? 'UNKNOWN';
}

export class TestFeature {
  constructor(
    private readonly featureUri: string,
    public generation: number
  ) {}

  async run(item: vscode.TestItem, options: vscode.TestRun): Promise<void> {
    const config = vscode.workspace.getConfiguration('qavajs');
    const launchCommand: string = config.get('launchCommand') ?? 'npx qavajs run';
    const command = `${launchCommand} --paths "${this.featureUri}" --format message`;

    const lineToItem = new Map<number, vscode.TestItem>();
    const collectItems = (col: vscode.TestItemCollection) => {
      col.forEach(child => {
        if (child.range) lineToItem.set(child.range.start.line + 1, child);
        collectItems(child.children);
      });
    };
    collectItems(item.children);

    return runCucumber(command, options, line => lineToItem.get(line));
  }
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
    const command = `${launchCommand} --paths "${this.testUri}" --name "${this.namePattern}" --format message`;
    return runCucumber(command, options, () => item);
  }
}
