import * as vscode from 'vscode';
import { exec } from 'child_process';

export default function executeCommand(context: vscode.ExtensionContext) {
    	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('qavajs.execute', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		if (vscode.window.activeTextEditor) {
			const { text } = vscode.window.activeTextEditor.document.lineAt(vscode.window.activeTextEditor.selection.active.line);
			if (vscode.workspace.workspaceFolders) {
				const scenarioName = text.replace(/Scenario:|Scenario Outline:/, '').trim();
				const command = `npm run qavajs -- --name "${scenarioName}" --format summary`
				vscode.window.showInformationMessage(`Executing: ${command}`);
				exec(
					command,
					{ cwd: vscode.workspace.workspaceFolders[0].uri.path },
					(error, stdout, stderr) => {
						if (error) {
							vscode.window.showInformationMessage(`exec error: ${error}`);
							return;
						}
						const isFailed = stdout.includes('Failures:');
						vscode.window.showInformationMessage(`${scenarioName} - ${isFailed ? 'Failed' : 'Passed'}`);
					});
			}

		}

	});

	context.subscriptions.push(disposable);
}