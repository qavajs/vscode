import * as vscode from 'vscode';
import { getMemoryFiles } from './getMemoryFiles';
import { getPoFiles } from './getPoFiles';

const poRegexp = '^\\s*(?<label>\\w+?)\\s*=\\s*(?<selector>\\${1,2}\\(.+?\\)\\)?)';
const memoryRegexp = '^\\s*(?<label>\\w+?)\\s*=\\s*(?<selector>.+?$)';

const poTriggerCharacters = ["'","'", '>'];
const memoryTriggerCharacters = ['$'];

export default function qavaAutocomplete(context: vscode.ExtensionContext) {
	const poCompletionProvider = vscode.languages.registerCompletionItemProvider(
		'cucumber',
		{
			async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: any, ctx: any) {	
				if (ctx.triggerCharacter && memoryTriggerCharacters.includes(ctx.triggerCharacter)) {
					try {
						const memoryFiles = await getMemoryFiles();
						const memory = (await Promise.all(memoryFiles
							.map(async ({ path, content }) => {
								const data = await content;
								const match = data.match(new RegExp(memoryRegexp, 'gmi'));
								const matches = match ? [...match] : [];
								return { path, matches }
							})))
							.reduce((s: any[], e: any) => [...s, ...e.matches.map((line: string) => ({ path: e.path, line }))], [])
							.map(po => {
								const match = po.line.match(new RegExp(memoryRegexp, 'mi'));
								return {
									label: match.groups.label,
									description: match.groups.selector
								}
							});
						return memory.map(k => new vscode.CompletionItem(k, vscode.CompletionItemKind.Field))
					} catch (e) {
						vscode.window.showErrorMessage(`Memory object is not loaded. Error: ${e} `);
					}
				}
				if (ctx.triggerCharacter && poTriggerCharacters.includes(ctx.triggerCharacter)) {
					try {
						const poFiles = await getPoFiles();
						const pos = (await Promise.all(poFiles
							.map(async ({ path, content }) => {
								const data = await content;
								const match = data.match(new RegExp(poRegexp, 'gmi'));
								const matches = match ? [...match] : [];
								return { path, matches }
							})))
							.reduce((s: any[], e: any) => [...s, ...e.matches.map((line: string) => ({ path: e.path, line }))], [])
							.map(po => {
								const match = po.line.match(new RegExp(poRegexp, 'mi'));
								return {
									label: match.groups.label.replace(/([A-Z])/g, ' $1').trim().replace(/\s+/g, ' '),
									description: match.groups.selector
								}
							}, []);
						return pos.map(k => {
							const completionItem = new vscode.CompletionItem(k, vscode.CompletionItemKind.Field);
							completionItem.insertText = ctx.triggerCharacter === '>' ? ' ' + k.label : k.label;
							return completionItem;
						})
					} catch (e) {
						vscode.window.showErrorMessage(`Page object is not loaded. Error: ${e} `);
					}
				}
			}
		},
		...poTriggerCharacters,
		...memoryTriggerCharacters
	);

	context.subscriptions.push(poCompletionProvider);
}