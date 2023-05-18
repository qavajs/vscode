import * as vscode from 'vscode';

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
				const terminalName = 'qavajs test';
				const scenarioName = text.replace(/Scenario:|Scenario Outline:/, '').trim();
				const config = vscode.workspace.getConfiguration('qavajs');
				const launchCommand: string = config.get('launchCommand') ?? 'npx qavajs run';
				const command = `${launchCommand} --name "${scenarioName}" --format summary`
				let terminal = vscode.window.terminals.find(term => term.name === terminalName);
				if (!terminal) {
					terminal = vscode.window.createTerminal(terminalName);
				}
				terminal.sendText(command);
				terminal.show();
			}
		}
	});

	context.subscriptions.push(disposable);
}