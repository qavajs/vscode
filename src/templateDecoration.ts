import * as vscode from 'vscode';
import { getTemplates } from './getTemplates';

export default function templateDecoration(context: vscode.ExtensionContext) {
    let editor = vscode.window.activeTextEditor;
	let timeout: NodeJS.Timer | undefined = undefined;

	const decorationType = vscode.window.createTextEditorDecorationType({
        color: '#90EE90'
	});

	async function updateDecorations() {
		if (editor) {
			const text = editor.document.getText();

			const templates = await getTemplates();
            const regexes = templates.map(template => new RegExp(template.replace(/<.+?>/g, '(.+?)'), 'g'));
            const decorations = [];
			let counter = 0;
            for (const regex of regexes) {
                let match;

                while ((match = regex.exec(text))) {
					counter++;
					if (counter > 50) break;
                    const startPos = editor.document.positionAt(match.index);
                    const endPos = editor.document.positionAt(match.index + match[0].length);
                    const decoration = { range: new vscode.Range(startPos, endPos) };
					vscode.window.setStatusBarMessage(match.index.toString());
                    decorations.push(decoration);
                }
            }

			// Apply the decorations to the editor
			editor.setDecorations(decorationType, []);
			editor.setDecorations(decorationType, decorations);
		}
	}
	// Get the active editor

	if (editor) {
		triggerUpdateDecorations();
	}

	function triggerUpdateDecorations(throttle = false) {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		if (throttle) {
			timeout = setTimeout(updateDecorations, 500);
		} else {
			updateDecorations();
		}
	}

	vscode.window.onDidChangeActiveTextEditor(e => {
		editor = e;
		if (editor) {
			triggerUpdateDecorations();
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		if (editor && event.document === editor.document) {
			triggerUpdateDecorations(true);
		}
	}, null, context.subscriptions);
}