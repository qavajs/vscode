// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import templateDecoration from './templateDecoration';
import templateAutocomplete from './templateAutocomplete';
import poAutocomplete from './poAutocomplete';
import executeCommand from './executeCommand';

import { startEmbeddedServer } from '@cucumber/language-server/wasm'
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node'

import { VscodeFiles } from './VscodeFiles'

let client: LanguageClient
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	executeCommand(context);
	poAutocomplete(context);
	// templateAutocomplete(context);	
	// templateDecoration(context);

	const serverOptions: ServerOptions = async () =>
    startEmbeddedServer(
      __dirname,
      () => new VscodeFiles(vscode.workspace.fs),
      () => undefined
    )

  const clientOptions: LanguageClientOptions = {
    // We need to list all supported languages here so that
    // the language server is notified to reindex when a file changes
    // https://code.visualstudio.com/docs/languages/identifiers#_known-language-identifiers
    documentSelector: [
      { scheme: 'file', language: 'cucumber' },
      { scheme: 'file', language: 'javascript' },
      { scheme: 'file', language: 'typescript' },
    ],
  }

  client = new LanguageClient('Cucumber', 'Cucumber Language Server', serverOptions, clientOptions)

  await client.start()
}

// This method is called when your extension is deactivated
export async function deactivate() {
	await client.stop()
}
