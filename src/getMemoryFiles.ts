import { join } from 'path';
import { glob } from 'glob';
import * as vscode from 'vscode';

export async function getMemoryFiles(): Promise<any[]> {
    const config = vscode.workspace.getConfiguration('qavajs');
    const templatesGlob: string | undefined = config.get('memory');
    if (templatesGlob && vscode.workspace.workspaceFolders) {
        const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const files = await glob(templatesGlob ?? [], { cwd });
        return Promise.all(files.map(async (file: string) => ({
            path: file,
            content: (await vscode.workspace.fs.readFile(vscode.Uri.file(join(cwd, file)))).toString()
        })));
    }
    return []
}