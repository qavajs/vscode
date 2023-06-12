import * as vscode from 'vscode';
import { join } from 'path';
enum FileType { TS, MJS, CJS };

function normalize(filePath: string) {
	return filePath.replace(/\\/g, '\\\\');
}

function getTSNodePath(): string | undefined {
	if (vscode.workspace.workspaceFolders) {
		const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
		return join(cwd, 'node_modules', 'ts-node')
	}
}

async function getFileType(filePath: string) {
	if (filePath.includes('.ts')) return FileType.TS
    const fileContent = (await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))).toString()
	if (fileContent.includes('exports')) return FileType.CJS;
	return FileType.MJS
}

export async function importFile(filePath: string) {
	switch (await getFileType(filePath)) {
		case FileType.CJS: return eval(`require('${normalize(filePath)}');`);
		case FileType.MJS: return eval(`import('${normalize(filePath)}');`);
		case FileType.TS: return eval(`(() => { require('${normalize(getTSNodePath() as string)}').register({transpileOnly: true}); return require('${normalize(filePath)}'); })()`);
		default: throw new Error('file is not supported');
	}
}
