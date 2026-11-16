import * as vscode from 'vscode';
import { registerGherkinFeatures } from './gherkinFeatures';
import { registerLanguageFeatures } from './qavajs/languageFeatures';
import { ProjectIndex } from './qavajs/projectIndex';
import testExplorer, { getWorkspaceTestPatterns } from './testExplorer';

import { startEmbeddedServer } from './startEmbeddedServer'
import { LanguageClient, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node'

import { VscodeFiles } from './VscodeFiles'

let client: LanguageClient | undefined
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  const testing = testExplorer(context);
  registerGherkinFeatures(context, getWorkspaceTestPatterns);
  const projectIndex = new ProjectIndex();
  context.subscriptions.push(projectIndex);
  registerLanguageFeatures(context, projectIndex);


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

  try {
    await client.start()
  } catch (e) {
    vscode.window.showErrorMessage(`qavajs: failed to start Cucumber language server: ${(e as Error).message}`)
  }

  // used by the integration tests only; not a supported API
  return { testing }
}

// This method is called when your extension is deactivated
export async function deactivate() {
  await client?.stop()
  client = undefined
}
