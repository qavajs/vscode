import * as vscode from 'vscode';
import { join } from 'path';
import { importFile } from './importFile';

function flattenObject(obj: any, prefix = '') {
	return Object.keys(obj).reduce((acc, key) => {
		if (['isCollection', 'ignoreHierarchy'].includes(key)) return acc;
		const newKey = prefix ? `${prefix} > ${key}` : key;
		if (typeof obj[key] === 'object') {
			//@ts-ignore
			acc.push(...flattenObject(obj[key], newKey));
		} else {
			//@ts-ignore
			acc.push(newKey.replace(' > selector', ''));
		}
		return acc;
	}, []).map((k: string) => k.replace(/([A-Z])/g, ' $1').trim().replace(/\s+/g, ' '));
}

export async function getPoFiles(): Promise<any[]> {
    const config = vscode.workspace.getConfiguration('qavajs');
    const poPath: string | undefined = config.get('pageObject');
    if (poPath && vscode.workspace.workspaceFolders) {
        const cwd = vscode.workspace.workspaceFolders[0].uri.path;
        const absolutePoPath = join(cwd, poPath);
        let po = await importFile(absolutePoPath);
        if (po.default) po = po.default;
        const data = typeof po === 'function' ? new po() : po;
        return flattenObject(data)
    }
    return [];
}