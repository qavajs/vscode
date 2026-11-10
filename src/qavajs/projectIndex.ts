import * as vscode from 'vscode';
import { maskSource, type ParameterTypeInfo, parseParameterTypes, parseStepDefinitions, type StepDefinitionInfo } from './jsSource';
import { StepMatcher } from './steps';

const MAX_FILES = 5000;
const textDecoder = new TextDecoder('utf-8');

interface ParsedSource {
  steps: StepDefinitionInfo[];
  parameterTypes: ParameterTypeInfo[];
}

/** Lazily (re)built index of step definitions (from `cucumber.glue`) per workspace folder. */
export class ProjectIndex implements vscode.Disposable {
  private readonly folders = new Map<string, FolderIndex>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,js,mjs,cjs,mts,cts}');
    const invalidate = (uri: vscode.Uri) => this.folderFor(uri)?.invalidate(uri);
    this.disposables.push(
      watcher,
      watcher.onDidCreate(invalidate),
      watcher.onDidChange(invalidate),
      watcher.onDidDelete(invalidate),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('cucumber')) {
          for (const folder of this.folders.values()) {
            folder.invalidate();
          }
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.folders.clear())
    );
  }

  private folderFor(uri: vscode.Uri): FolderIndex | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return undefined;
    }
    const key = folder.uri.toString();
    let index = this.folders.get(key);
    if (!index) {
      index = new FolderIndex(folder);
      this.folders.set(key, index);
    }
    return index;
  }

  async steps(uri: vscode.Uri): Promise<StepMatcher | undefined> {
    return this.folderFor(uri)?.steps();
  }

  dispose() {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

class FolderIndex {
  private readonly cache = new Map<string, { mtime: number; parsed: ParsedSource }>();
  private current?: Promise<StepMatcher>;
  private dirty = true;

  constructor(private readonly folder: vscode.WorkspaceFolder) { }

  invalidate(uri?: vscode.Uri) {
    if (uri) {
      this.cache.delete(uri.toString());
    }
    this.dirty = true;
  }

  steps(): Promise<StepMatcher> {
    if (this.dirty || !this.current) {
      this.dirty = false;
      this.current = this.build().catch(e => {
        this.dirty = true;
        throw e;
      });
    }
    return this.current;
  }

  private async parse(uri: vscode.Uri): Promise<ParsedSource | undefined> {
    try {
      const { mtime } = await vscode.workspace.fs.stat(uri);
      const cached = this.cache.get(uri.toString());
      if (cached && cached.mtime === mtime) {
        return cached.parsed;
      }
      const text = textDecoder.decode(await vscode.workspace.fs.readFile(uri));
      const masked = maskSource(text);
      const parsed = { steps: parseStepDefinitions(text, masked), parameterTypes: parseParameterTypes(text, masked) };
      this.cache.set(uri.toString(), { mtime, parsed });
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async build(): Promise<StepMatcher> {
    const cucumber = vscode.workspace.getConfiguration('cucumber', this.folder.uri);
    const globs = cucumber.get<string[]>('glue') ?? [];
    const found = await Promise.all(globs.map(glob => vscode.workspace.findFiles(new vscode.RelativePattern(this.folder, glob), undefined, MAX_FILES)));
    const seen = new Set<string>();
    const uris = found.flat().filter(uri => !seen.has(uri.toString()) && seen.add(uri.toString()));
    const glue = (await Promise.all(uris.map(async uri => ({ uri, parsed: await this.parse(uri) })))).filter(
      (x): x is { uri: vscode.Uri; parsed: ParsedSource } => !!x.parsed
    );

    const settingTypes = (cucumber.get<{ name: string; regexp: string }[]>('parameterTypes') ?? [])
      .filter(t => t?.name)
      .map(t => ({ name: t.name, regexp: t.regexp ? { source: String(t.regexp), flags: '' } : undefined }));

    return new StepMatcher(
      glue.flatMap(({ uri, parsed }) => parsed.steps.map(s => ({ ...s, file: uri.toString() }))),
      [...settingTypes, ...glue.flatMap(({ parsed }) => parsed.parameterTypes)]
    );
  }
}
