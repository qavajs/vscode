import * as vscode from 'vscode';
import { join, extname } from 'path';
import { readFile } from 'fs/promises';

enum FileType { TS, MJS, CJS }
async function getFileType(filePath: string) {
	if (filePath.includes('.ts')) return FileType.TS
	const fileContent = await readFile(filePath, 'utf-8');
	if (fileContent.includes('exports')) return FileType.CJS;
	return FileType.MJS
}

async function importPO(filePath: string, fileType: FileType) {
	switch (fileType) {
		case FileType.CJS: return eval(`require('${filePath}');`);
		case FileType.MJS: return eval(`import('${filePath}');`);
		default: throw new Error('file is not supported');
	}
}

function flattenObject(obj: any, prefix = '') {
	return Object.keys(obj).reduce((acc, key) => {
		//, 'ignoreHierarchy'
		if (['isCollection', 'ignoreHierarchy'].includes(key)) return acc;
		const newKey = prefix ? `${prefix} > ${key}` : key;
		if (typeof obj[key] === 'object') {
			//@ts-ignore
			acc.push(...flattenObject(obj[key], newKey));
		} else {
			//@ts-ignore
			acc.push(newKey.replace(' > selector', ''));
		}
		return acc;
	}, []).map((k: string) => k.replace(/([A-Z])/g, ' $1').trim().replace(/\s+/g, ' '));
}

export default function poAutocomplete(context: vscode.ExtensionContext) {
	const poCompletionProvider = vscode.languages.registerCompletionItemProvider(
		'cucumber',
		{
			async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
				const config = vscode.workspace.getConfiguration('qavajs');
				const poPath: string | undefined = config.get('pageObject');
				if (!poPath) return
				if (extname(poPath) === '.ts') {
					vscode.window.showInformationMessage(`Typescript page objects is not suported yet. Stay tune!`);
					return
				}
				if (vscode.workspace.workspaceFolders) {
					try {
						const cwd = vscode.workspace.workspaceFolders[0].uri.path;
						const absolutePoPath = join(cwd, poPath);
						const fileType = await getFileType(absolutePoPath);
						let po = await importPO(absolutePoPath, fileType);
						if (po.default) po = po.default;
						let data = null;
						const q = new po();
						data = typeof po === 'function' ? new po() : po;
						debugger
						return flattenObject(data).map(k => new vscode.CompletionItem(k, vscode.CompletionItemKind.Field));
					} catch (e) {
						vscode.window.showErrorMessage(`Page object is not loaded. Error: ${e} `);
					}
				}
			}
		}
	);

	context.subscriptions.push(poCompletionProvider);
}