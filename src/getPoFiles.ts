import { readFile } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';
import * as vscode from 'vscode';

export async function getPoFiles(): Promise<any[]> {
    const config = vscode.workspace.getConfiguration('qavajs');
    const templatesGlob: string | undefined = config.get('pageObjects');
    if (vscode.workspace.workspaceFolders) {
        const cwd = vscode.workspace.workspaceFolders[0].uri.path;
        const templateFiles = await glob(templatesGlob ?? [], { cwd });
        return Promise.all(templateFiles.map(async (file: string) => ({
            path: file,
            content: await readFile(join(cwd, file), 'utf-8')
        })));
    }
    return []
}