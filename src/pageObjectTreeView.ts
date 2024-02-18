import * as vscode from 'vscode';
import { PageObjectTreeDataProvider } from './PageObjectTreeDataProvider';

export default async function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('qavajs');
    const poPath: string | undefined = config.get('pageObject');

    vscode.window.registerTreeDataProvider(
        'pageObject',
        new PageObjectTreeDataProvider(poPath as string)
    );

    const treeDataProvider = new PageObjectTreeDataProvider(poPath as string);
    vscode.window.createTreeView('pageObject', { treeDataProvider });

    context.subscriptions.push(vscode.commands.registerCommand('pageObject.copy', (pageObjectItem) => {
        return vscode.env.clipboard.writeText(pageObjectItem.path)
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pageObject.refresh', () => {
        return treeDataProvider.refresh();
    }));
}