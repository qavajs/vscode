import { dialects } from '@cucumber/gherkin';
import * as vscode from 'vscode';
import type { Pos } from './jsSource';
import type { ProjectIndex } from './projectIndex';
import { parseJsDoc, parseStepLine } from './steps';

const SELECTOR: vscode.DocumentSelector = { language: 'cucumber', scheme: 'file' };

/** Step definition docs (JSDoc) on hover in feature files. */
export function registerLanguageFeatures(context: vscode.ExtensionContext, index: ProjectIndex) {
  context.subscriptions.push(vscode.languages.registerHoverProvider(SELECTOR, new StepHoverProvider(index)));
}

function stepKeywords(document: vscode.TextDocument): string[] {
  let language = 'en';
  for (let i = 0; i < Math.min(document.lineCount, 10); i++) {
    const m = /^\s*#\s*language\s*:\s*([\w-]+)/.exec(document.lineAt(i).text);
    if (m) {
      language = m[1];
      break;
    }
  }
  const dialect = (dialects as Record<string, (typeof dialects)['en']>)[language] ?? dialects.en;
  return [...dialect.given, ...dialect.when, ...dialect.then, ...dialect.and, ...dialect.but];
}

function sourceLink(file: string, pos: Pos): string {
  const uri = vscode.Uri.parse(file);
  const label = `${vscode.workspace.asRelativePath(uri)}:${pos.line + 1}`;
  return `[${label}](${uri.with({ fragment: `L${pos.line + 1},${pos.character + 1}` }).toString()})`;
}

function codeBlock(text: string, language: string): string {
  const fence = text.includes('```') ? '~~~' : '```';
  return `${fence}${language}\n${text}\n${fence}`;
}

function codeInline(text: string) {
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
}

class StepHoverProvider implements vscode.HoverProvider {
  constructor(private readonly index: ProjectIndex) { }

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const lineText = document.lineAt(position.line).text;
    if (/^\s*#/.test(lineText)) {
      return undefined;
    }
    const step = parseStepLine(lineText, stepKeywords(document));
    if (!step) {
      return undefined;
    }
    const def = (await this.index.steps(document.uri))?.match(step.text);
    if (!def) {
      return undefined;
    }
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${def.keyword}** ${codeInline(def.regex ? `/${def.expression}/${def.regex.flags}` : def.expression)}\n\n`);
    if (def.doc) {
      const doc = parseJsDoc(def.doc);
      if (doc.description) {
        md.appendMarkdown(`${doc.description}\n\n`);
      }
      if (doc.params.length) {
        md.appendMarkdown(
          `${doc.params.map(p => `- \`${p.name}\`${p.type ? ` *{${p.type}}*` : ''}${p.description ? ` — ${p.description}` : ''}`).join('\n')}\n\n`
        );
      }
      for (const example of doc.examples) {
        md.appendMarkdown(`${codeBlock(example.trim(), 'gherkin')}\n\n`);
      }
      for (const tag of doc.tags) {
        md.appendMarkdown(`*@${tag.tag}* ${tag.text}\n\n`);
      }
    }
    md.appendMarkdown(sourceLink(def.file, def.pos));
    const range = new vscode.Range(position.line, step.textStart, position.line, step.textStart + step.text.length);
    return new vscode.Hover(md, range);
  }
}
