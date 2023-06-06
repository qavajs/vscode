import * as vscode from 'vscode';
import { join } from 'path';
import { importFile } from './importFile';

export async function getMemoryFiles(): Promise<any[]> {
    const config = vscode.workspace.getConfiguration('qavajs');
    const memoryPath: string | undefined = config.get('memory');
    if (memoryPath && vscode.workspace.workspaceFolders) {
        const cwd = vscode.workspace.workspaceFolders[0].uri.path;
        const absoluteMemoryPath = join(cwd, memoryPath);
        let memory = await importFile(absoluteMemoryPath);
        if (memory.default) memory = memory.default;
        const data = typeof memory === 'function' ? new memory() : memory;
        return Object.keys(data)
    }
    return [];
}