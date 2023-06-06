import * as vscode from 'vscode';
import { getMemoryFiles } from './getMemoryFiles';
import { getPoFiles } from './getPoFiles';

const poTriggerCharacters = ['?'];
const memoryTriggerCharacters = ['$'];

export default function qavaAutocomplete(context: vscode.ExtensionContext) {
	const poCompletionProvider = vscode.languages.registerCompletionItemProvider(
		'cucumber',
		{
			async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: any, ctx: any) {
				if (ctx.triggerCharacter && memoryTriggerCharacters.includes(ctx.triggerCharacter)) {
					try {
						const memory = await getMemoryFiles();
						return memory.map(k => new vscode.CompletionItem(k, vscode.CompletionItemKind.Field))
					} catch (e) {
						vscode.window.showErrorMessage(`Memory object is not loaded. Error: ${e} `);
					}
				}
				if (ctx.triggerCharacter && poTriggerCharacters.includes(ctx.triggerCharacter)) {
					if (vscode.workspace.workspaceFolders) {
						try {
							const poSuggestions = await getPoFiles();
							if (poSuggestions.length === 0) return;
							return poSuggestions.map(k => new vscode.CompletionItem(k, vscode.CompletionItemKind.Field));
						} catch (e) {
							vscode.window.showErrorMessage(`Page object is not loaded. Error: ${e} `);
						}
					}
				}
			}
		},
		...poTriggerCharacters,
		...memoryTriggerCharacters
	);

	context.subscriptions.push(poCompletionProvider);
}