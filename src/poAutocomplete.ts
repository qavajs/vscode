import * as vscode from 'vscode';
import { getPoFiles } from './getPoFiles';

const poRegexp = '(?<label>\\w+?)\\s*=\\s*(?<selector>\\$\\(.+?\\)\\)?)';

export default function poAutocomplete(context: vscode.ExtensionContext) {
	const poCompletionProvider = vscode.languages.registerCompletionItemProvider(
		'cucumber',
		{
			async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
				try {
					const poFiles = await getPoFiles();
					const pos = (await Promise.all(poFiles
					.map(async ({path, content}) => {
						const data = await content;
						const match = data.match(new RegExp(poRegexp, 'gmi'));
						const matches = match ? [...match] : [];
						return { path, matches }
					})))
					.reduce((s: any[], e: any) => [...s, ...e.matches.map((line: string) => ({path: e.path, line}))], [])
					.map(po => {
						const match = po.line.match(new RegExp(poRegexp, 'mi'));
						return {
							label: match.groups.label.replace(/([A-Z])/g, ' $1').trim().replace(/\s+/g, ' '),
							detail: ' ' + match.groups.selector,
							description: po.path
						} 
					});
					return pos.map(k => new vscode.CompletionItem(k, vscode.CompletionItemKind.Field))
				} catch (e) {
					vscode.window.showErrorMessage(`Page object is not loaded. Error: ${e} `);
				}
			}
		},
		'>'
	);

	context.subscriptions.push(poCompletionProvider);
}