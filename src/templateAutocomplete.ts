import * as vscode from 'vscode';
import { getTemplates } from './getTemplates';

export default function templateAutocomplete(context: vscode.ExtensionContext) {
    const templateCompletionProvider = vscode.languages.registerCompletionItemProvider(
		'cucumber',
		{
			async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
				let data: string[] = [];
				try {
					data = await getTemplates();
				} catch (e) {
					vscode.window.showErrorMessage(`Template file is not loaded. Error: ${e} `);
				}

				return data.map(k => new vscode.CompletionItem(k, vscode.CompletionItemKind.Method));
			}
		}
	);

	context.subscriptions.push(templateCompletionProvider);
}