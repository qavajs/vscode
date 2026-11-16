import type { GherkinDocument } from '@cucumber/messages';
import * as vscode from 'vscode';
import { parseGherkinDocument } from './gherkin';
import { computeFolds, type FeatureSymbol, featureSymbols, fuzzyMatch } from './gherkinOutline';

const SELECTOR: vscode.DocumentSelector = { language: 'cucumber' };
const textDecoder = new TextDecoder('utf-8');

export function registerGherkinFeatures(context: vscode.ExtensionContext, featurePatterns: () => vscode.GlobPattern[]) {
  const symbolCache = new Map<string, { mtime: number; symbols: FeatureSymbol[] }>();

  const foldingProvider: vscode.FoldingRangeProvider = {
    provideFoldingRanges(document) {
      let doc: GherkinDocument;
      try {
        doc = parseGherkinDocument(document.getText());
      } catch {
        return undefined; // keep VS Code's indentation folding while the file has syntax errors
      }
      return computeFolds(document.getText(), doc).map(
        f => new vscode.FoldingRange(f.start, f.end, f.kind === 'comment' ? vscode.FoldingRangeKind.Comment : undefined)
      );
    },
  };

  const symbolsFor = async (uri: vscode.Uri): Promise<FeatureSymbol[]> => {
    const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    try {
      if (open?.isDirty) {
        return featureSymbols(parseGherkinDocument(open.getText()));
      }
      const { mtime } = await vscode.workspace.fs.stat(uri);
      const cached = symbolCache.get(uri.toString());
      if (cached?.mtime === mtime) {
        return cached.symbols;
      }
      const symbols = featureSymbols(parseGherkinDocument(textDecoder.decode(await vscode.workspace.fs.readFile(uri))));
      symbolCache.set(uri.toString(), { mtime, symbols });
      return symbols;
    } catch {
      return [];
    }
  };

  const symbolProvider: vscode.WorkspaceSymbolProvider = {
    async provideWorkspaceSymbols(query, token) {
      const needle = query.toLowerCase().replace(/\s+/g, '');
      const files = (await Promise.all(featurePatterns().map(p => vscode.workspace.findFiles(p)))).flat();
      const result: vscode.SymbolInformation[] = [];
      for (const uri of files) {
        if (token.isCancellationRequested) {
          break;
        }
        for (const s of await symbolsFor(uri)) {
          if (s.kind === 'background' || !fuzzyMatch(s.name.toLowerCase().replace(/\s+/g, ''), needle)) {
            continue;
          }
          const kind = s.kind === 'feature' ? vscode.SymbolKind.Module : s.kind === 'rule' ? vscode.SymbolKind.Namespace : vscode.SymbolKind.Function;
          result.push(
            new vscode.SymbolInformation(
              `${s.keyword}: ${s.name}`,
              kind,
              s.container ?? '',
              new vscode.Location(uri, new vscode.Position(s.line, 0))
            )
          );
        }
      }
      return result;
    },
  };

  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(SELECTOR, foldingProvider),
    vscode.languages.registerWorkspaceSymbolProvider(symbolProvider)
  );
}
