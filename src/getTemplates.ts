import { readFile } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';
import * as vscode from 'vscode';

export async function getTemplates(): Promise<string[]> {
    const config = vscode.workspace.getConfiguration('qavajs');
    const templatesGlob: string | undefined = config.get('templates');
    if (vscode.workspace.workspaceFolders) {
        const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const templateFiles = await glob(templatesGlob ?? [], { cwd });
        const fileContents: string[] = await Promise.all(
            templateFiles.map(async (file: string) => (await vscode.workspace.fs.readFile(vscode.Uri.file(join(cwd, file)))).toString())
        );
        return fileContents
            .map((file: string) => {
                const matches = file.match(/Scenario: (.+)/g);
                const scenarios = matches ? [...matches] : [];
                return scenarios.map((k: string) => k.replace('Scenario: ', ''))
            })
            .reduce((s, f) => ([...s, ...f]), [])
    }
    return []
}