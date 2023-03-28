import { readFile } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';
import * as vscode from 'vscode';

export async function getTemplates(): Promise<string[]> {
    const config = vscode.workspace.getConfiguration('qavajs');
    const templatesGlob: string | undefined = config.get('templates');
    if (vscode.workspace.workspaceFolders) {
        const cwd = vscode.workspace.workspaceFolders[0].uri.path;
        const templateFiles = await glob(templatesGlob ?? [], { cwd });
        const fileContents: string[] = await Promise.all(templateFiles.map((file: string) => readFile(join(cwd, file), 'utf-8')));
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