import * as vscode from 'vscode';
import { getPoFiles } from './getPoFiles';

export default function poAutocomplete(context: vscode.ExtensionContext) {
	const poCompletionProvider = vscode.languages.registerCompletionItemProvider(
		'cucumber',
		{
			async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
				try {
					const poRegexp = '(?<label>\\w+?)\\s*=\\s*(?<selector>\\$\\(.+?\\)\\)?)';
					const poFiles = await getPoFiles();
					const pos = poFiles
					.map(({path, content}) => {
						const match = content.match(new RegExp(poRegexp, 'gmi'));
						const matches = match ? [...match] : [];
						return { path, matches }
					})
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