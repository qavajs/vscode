import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';
const textDecoder = new TextDecoder('utf-8');

export type TestData = TestFile | TestCase;

export const testData = new WeakMap<vscode.TestItem, TestData>();

let generationCounter = 0;

export const getContentFromFilesystem = async (uri: vscode.Uri) => {
	try {
		const rawContent = await vscode.workspace.fs.readFile(uri);
		return textDecoder.decode(rawContent);
	} catch (e) {
		console.warn(`Error providing tests for ${uri.fsPath}`, e);
		return '';
	}
};

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

	/**
	 * Parses the tests from the input text, and updates the tests contained
	 * by this file to be those from the text,
	 */
	public updateFromContents(controller: vscode.TestController, content: string, item: vscode.TestItem) {
		const ancestors = [{ item, children: [] as vscode.TestItem[] }];
		const thisGeneration = generationCounter++;
		this.didResolve = true;

		const ascend = (depth: number) => {
			while (ancestors.length > depth) {
				const finished = ancestors.pop()!;
				finished.item.children.replace(finished.children);
			}
		};

		parseFeature(content, {
			onTest: (range, testName) => {
				const parent = ancestors[ancestors.length - 1];
				const data = new TestCase(testName, item.uri?.fsPath as string, thisGeneration);
				const id = `${item.uri}/${data.getLabel()}${randomUUID()}`;
				const tcase = controller.createTestItem(id, data.getLabel(), item.uri);
				testData.set(tcase, data);
				tcase.range = range;
				parent.children.push(tcase);
			}

		});

		ascend(0); // finish and assign children for all remaining items
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
        const escapeExamples = this.testName.replace(/[-[\]{}()*+?.,^]/g, '\\$&').replace(/(<.+?>)/g, '.+?');
        return `^${escapeExamples}$`;
    }

	async run(item: vscode.TestItem, options: vscode.TestRun): Promise<void> {
        const config = vscode.workspace.getConfiguration('qavajs');
        const launchCommand: string = config.get('launchCommand') ?? 'npx qavajs run';
        const command = `${launchCommand} --paths "${this.testUri}" --name "${this.namePattern}" --format summary`;
        options.appendOutput(command);
        return new Promise(resolve => {
			const shell = platform() === 'win32' ? 'powershell.exe' : '/bin/sh';
			const cwd = (vscode.workspace.workspaceFolders as any)[0].uri.fsPath;
            exec(command, { cwd, shell }, (err, stdout, stderr) => {
                if (err) {
					const message = /\(\d+ (failed|undefined)\)/.test(stdout) 
						? stdout 
						: err.message;
					options.failed(item, new vscode.TestMessage(message));
					resolve();
				}
				options.appendOutput(stdout.replace(/\n/g, '\r\n'));
				if (/scenarios? \(\d+ passed\)/.test(stdout)) {
                    options.passed(item);
				}
				if (stdout.includes('0 scenarios')) {
                    options.skipped(item);
                } 
                resolve();
              });
        })
	}

}

const testRe = /(?:Scenario|Scenario Outline): (.+)/;

export function parseFeature(text: string, events: {
	onTest(range: vscode.Range, testName: string): void;
}) {
	const lines = text.split('\n');

	for (let lineNo = 0; lineNo < lines.length; lineNo++) {
		const line = lines[lineNo];
		const test = testRe.exec(line);
		if (test) {
            const [, testName] = test;
			const range = new vscode.Range(new vscode.Position(lineNo, 0), new vscode.Position(lineNo, test[0].length));
			events.onTest(range, testName);
		}
	}
};