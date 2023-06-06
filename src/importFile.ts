import * as vscode from 'vscode';
enum FileType { TS, MJS, CJS };

async function getFileType(filePath: string) {
	if (filePath.includes('.ts')) return FileType.TS
    const fileContent = (await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))).toString()
	if (fileContent.includes('exports')) return FileType.CJS;
	return FileType.MJS
}

export async function importFile(filePath: string) {
	switch (await getFileType(filePath)) {
		case FileType.CJS: return eval(`require('${filePath}');`);
		case FileType.MJS: return eval(`import('${filePath}');`);
		case FileType.TS: return eval(`(() => { require('ts-node').register({transpileOnly: true}); return require('${filePath}'); })()`);
		default: throw new Error('file is not supported');
	}
}
