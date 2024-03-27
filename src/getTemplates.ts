import { join } from 'node:path';
import { glob } from 'glob';
import * as vscode from 'vscode';
import { ExpressionFactory } from '@cucumber/cucumber-expressions'

export async function getTemplateFiles() {
    const config = vscode.workspace.getConfiguration('qavajs');
    const templatesGlob: string | undefined = config.get('templates');
    if (templatesGlob && vscode.workspace.workspaceFolders) {
        const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const templateFiles = await glob(templatesGlob ?? [], { cwd });
        return await Promise.all(
            templateFiles.map(async (file: string) => ({
                content: (await vscode.workspace.fs.readFile(vscode.Uri.file(join(cwd, file)))).toString(),
                uri: vscode.Uri.file(join(cwd, file))
            }))
        );
    }
}

export async function getTemplateCoordinates(registry: any): Promise<any[]> {
    const templateFiles = await getTemplateFiles() as any[];
    return templateFiles
        .map((file: { content: string, uri: vscode.Uri }) => {
            const lines = file.content.split('\n');
            return lines.reduce((acc, lineText, line) => {
                const match = lineText.match(/Scenario: (.+)/);
                if (match && match[1]) {
                    const expression = new RegExp(`^${match[1].trim().replace(/<.+?>/g, '(.+?)')}$`);
                    acc.push({
                        expression: new ExpressionFactory(registry).createExpression(expression),
                        locationLink: {
                            targetRange: {
                                start: { line, character: 0 },
                                end: { line, character: 0 }
                            },
                            targetSelectionRange: {
                                start: { line, character: 0 },
                                end: { line, character: 0 }
                            },
                            targetUri: file.uri.fsPath
                        },
                    })
                }
                return acc
            }, [] as any);
        })
        .reduce((s, f) => ([...s, ...f]), [])
}

export async function getTemplateSuggestions(): Promise<any[]> {
    const templateFiles = (await getTemplateFiles())?.map(f => f.content) as string[];
    return templateFiles
        .map((file: string) => {
            const matches = file.match(/Scenario: (.+)/g);
            const scenarios = matches ? [...matches] : [];
            return scenarios.map((k: string) => k.replace('Scenario: ', ''))
        })
        .reduce((s, f) => ([...s, ...f]), [])
        .map(s => { 
            let tagIndex = 0;
            const segments = s.replace(/<.+?>/g, () => {
              tagIndex++;
              return `||\${${tagIndex}}||`;
            });
            return { label: s, segments: segments.split('||'), matched: true }
        })
}