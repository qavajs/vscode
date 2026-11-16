import * as path from 'node:path';
import * as vscode from 'vscode';
import { profileNames, resolveLaunch } from './runner/launch';
import { type BatchTarget, runBatch } from './runner/runBatch';
import { instrumentRun, onRunCall, type TestingApi } from './testing';
import { gatherTestItems, TestFile, TestNode, testData } from './testTree';

const PARSE_DEBOUNCE_MS = 300;
export const CONTROLLER_ID = 'qavajs';

export default function activate(context: vscode.ExtensionContext): TestingApi {
  const controller = vscode.tests.createTestController(CONTROLLER_ID, 'qavajs tests');
  context.subscriptions.push(controller);

  const attachmentsRoot = vscode.Uri.joinPath(context.storageUri ?? context.globalStorageUri, 'attachments');
  // attachments of previous sessions are no longer referenced by any test result
  void Promise.resolve(vscode.workspace.fs.delete(attachmentsRoot, { recursive: true, useTrash: false })).catch(() => undefined);

  // launch profile name per run profile; undefined means "use qavajs.launchCommand"
  const profileNamesByRunProfile = new Map<vscode.TestRunProfile, string | undefined>();

  const fileChangedEmitter = new vscode.EventEmitter<vscode.Uri>();
  context.subscriptions.push(fileChangedEmitter);
  const watchingTests = new Map<vscode.TestItem | 'ALL', vscode.TestRunProfile | undefined>();
  fileChangedEmitter.event(uri => {
    if (watchingTests.has('ALL')) {
      startTestRun(new vscode.TestRunRequest(undefined, undefined, watchingTests.get('ALL'), true));
      return;
    }
    // group watched items of this file by profile so each profile runs with its own command
    const byProfile = new Map<vscode.TestRunProfile | undefined, vscode.TestItem[]>();
    for (const [item, profile] of watchingTests) {
      if (item !== 'ALL' && item.uri?.toString() === uri.toString()) {
        byProfile.set(profile, [...(byProfile.get(profile) ?? []), item]);
      }
    }
    for (const [profile, include] of byProfile) {
      startTestRun(new vscode.TestRunRequest(include, undefined, profile, true));
    }
  });

  const runHandler = async (request: vscode.TestRunRequest, cancellation: vscode.CancellationToken): Promise<void> => {
    if (!vscode.workspace.isTrusted) {
      const manage = 'Manage Workspace Trust';
      void vscode.window
        .showWarningMessage('qavajs: running tests executes workspace code and requires a trusted workspace.', manage)
        .then(choice => choice === manage && vscode.commands.executeCommand('workbench.trust.manage'));
      return;
    }
    if (!request.continuous) {
      await startTestRun(request, cancellation);
      return;
    }

    if (request.include === undefined) {
      watchingTests.set('ALL', request.profile);
      cancellation.onCancellationRequested(() => watchingTests.delete('ALL'));
    } else {
      const include = request.include;
      for (const item of include) {
        watchingTests.set(item, request.profile);
      }
      cancellation.onCancellationRequested(() => {
        for (const item of include) {
          watchingTests.delete(item);
        }
      });
    }
  };

  const startTestRun = async (request: vscode.TestRunRequest, requestToken?: vscode.CancellationToken) => {
    const run = instrumentRun(controller.createTestRun(request));
    // stop when either the run (Test Results "stop") or the request is cancelled
    const cancellation = new vscode.CancellationTokenSource();
    const cancelListeners = [run.token, requestToken].map(t => t?.onCancellationRequested(() => cancellation.cancel()));
    if (run.token.isCancellationRequested || requestToken?.isCancellationRequested) {
      cancellation.cancel();
    }
    const exclude = new Set(request.exclude ?? []);
    const queue: BatchTarget[] = [];

    const enqueueDescendants = (parent: vscode.TestItem) => {
      parent.children.forEach(child => {
        run.enqueued(child);
        enqueueDescendants(child);
      });
    };

    const hasExcludedDescendant = (item: vscode.TestItem): boolean =>
      gatherTestItems(item.children).some(child => exclude.has(child) || hasExcludedDescendant(child));

    const discoverTests = async (tests: Iterable<vscode.TestItem>) => {
      for (const test of tests) {
        if (exclude.has(test)) {
          continue;
        }
        const data = testData.get(test);
        if (data instanceof TestNode && !hasExcludedDescendant(test)) {
          run.enqueued(test);
          enqueueDescendants(test);
          queue.push({ item: test, node: data });
          continue;
        }
        if (data instanceof TestFile && !data.didResolve) {
          await data.updateFromDisk(controller, test);
        }
        await discoverTests(gatherTestItems(test.children));
      }
    };

    try {
      await discoverTests(request.include ?? gatherTestItems(controller.items));

      // one process per workspace folder: browsers and the qavajs bootstrap are paid once per run
      const batches = new Map<string, { folder?: vscode.WorkspaceFolder; targets: BatchTarget[] }>();
      for (const target of queue) {
        const folder = vscode.workspace.getWorkspaceFolder(target.item.uri!);
        const key = folder?.uri.toString() ?? path.dirname(target.node.fsPath);
        const batch = batches.get(key) ?? { folder, targets: [] };
        batch.targets.push(target);
        batches.set(key, batch);
      }

      const profileName = request.profile ? profileNamesByRunProfile.get(request.profile) : undefined;
      const debug = request.profile?.kind === vscode.TestRunProfileKind.Debug;
      const attachmentsDir = vscode.Uri.joinPath(attachmentsRoot, `${Date.now()}`);
      for (const { folder, targets } of batches.values()) {
        if (cancellation.token.isCancellationRequested) {
          for (const { item } of targets) {
            run.skipped(item);
          }
          continue;
        }
        const launch = resolveLaunch(profileName, folder, path.dirname(targets[0].node.fsPath));
        for (const { item } of targets) {
          run.started(item);
        }
        await runBatch(targets, run, { launch, folder, debug, attachmentsDir, token: cancellation.token });
      }
    } catch (e) {
      run.appendOutput(`qavajs: ${(e as Error).stack ?? e}\r\n`);
    } finally {
      for (const l of cancelListeners) {
        l?.dispose();
      }
      cancellation.dispose();
      run.end();
    }
  };

  const createRunProfiles = (): vscode.TestRunProfile[] => {
    profileNamesByRunProfile.clear();
    const names = profileNames();
    const entries: (string | undefined)[] = names.length ? names : [undefined];
    return entries.flatMap((name, i) => {
      const label = name ?? 'Run Tests';
      const runProfile = controller.createRunProfile(label, vscode.TestRunProfileKind.Run, runHandler, i === 0, undefined, true);
      const debugProfile = controller.createRunProfile(name ?? 'Debug Tests', vscode.TestRunProfileKind.Debug, runHandler, i === 0);
      profileNamesByRunProfile.set(runProfile, name);
      profileNamesByRunProfile.set(debugProfile, name);
      return [runProfile, debugProfile];
    });
  };

  let runProfiles = createRunProfiles();
  const recreateRunProfiles = () => {
    disposeAll(runProfiles);
    runProfiles = createRunProfiles();
  };
  let watchers: vscode.Disposable[] = [];
  let watchingWorkspace = false;

  const rebuildTree = async () => {
    controller.items.replace([]);
    await Promise.all(getWorkspaceTestPatterns().map(pattern => findInitialFiles(controller, pattern)));
  };

  const restartWatchers = () => {
    disposeAll(watchers);
    watchers = watchingWorkspace ? startWatchingWorkspace(controller, fileChangedEmitter) : [];
  };

  controller.refreshHandler = rebuildTree;

  controller.resolveHandler = async item => {
    if (!item) {
      watchingWorkspace = true;
      restartWatchers();
      return;
    }

    const data = testData.get(item);
    if (data instanceof TestFile) {
      await data.updateFromDisk(controller, item);
    }
  };

  const parseTimers = new Map<string, NodeJS.Timeout>();
  const updateNodeForDocument = (doc: vscode.TextDocument, debounce: boolean) => {
    if (doc.uri.scheme !== 'file' || !doc.uri.path.endsWith('.feature')) {
      return;
    }
    const key = doc.uri.toString();
    clearTimeout(parseTimers.get(key));
    const update = () => {
      parseTimers.delete(key);
      const { file, data } = getOrCreateFile(controller, doc.uri);
      data.updateFromContents(controller, doc.getText(), file);
    };
    if (debounce) {
      parseTimers.set(key, setTimeout(update, PARSE_DEBOUNCE_MS));
    } else {
      update();
    }
  };

  rebuildTree();

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => updateNodeForDocument(doc, false)),
    vscode.workspace.onDidChangeTextDocument(e => updateNodeForDocument(e.document, true)),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('qavajs.launchProfiles') || e.affectsConfiguration('qavajs.launchCommand')) {
        recreateRunProfiles();
      }
      if (e.affectsConfiguration('cucumber.features')) {
        restartWatchers();
        rebuildTree();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      recreateRunProfiles();
      restartWatchers();
      rebuildTree();
    }),
    // launch settings are restricted in untrusted workspaces, so they change once trust is granted
    vscode.workspace.onDidGrantWorkspaceTrust(recreateRunProfiles),
    {
      dispose: () => {
        disposeAll(runProfiles);
        disposeAll(watchers);
        for (const timer of parseTimers.values()) {
          clearTimeout(timer);
        }
      },
    }
  );

  return { controller, runProfiles: () => runProfiles, onRunCall };
}

function disposeAll(disposables: readonly vscode.Disposable[]) {
  for (const d of disposables) {
    d.dispose();
  }
}

function getOrCreateFile(controller: vscode.TestController, uri: vscode.Uri) {
  const existing = controller.items.get(uri.toString());
  if (existing) {
    return { file: existing, data: testData.get(existing) as TestFile };
  }

  const file = controller.createTestItem(uri.toString(), uri.path.split('/').pop()!, uri);
  // relative folder (prefixed with the workspace folder name in multi-root) disambiguates same-named files
  const relativeDir = path.posix.dirname(vscode.workspace.asRelativePath(uri, (vscode.workspace.workspaceFolders?.length ?? 0) > 1));
  if (relativeDir !== '.') {
    file.description = relativeDir;
  }
  controller.items.add(file);

  const data = new TestFile();
  testData.set(file, data);

  file.canResolveChildren = true;
  return { file, data };
}

/** `cucumber.features` globs of every workspace folder, read with that folder's settings. */
export function getWorkspaceTestPatterns(): vscode.RelativePattern[] {
  return (vscode.workspace.workspaceFolders ?? []).flatMap(folder =>
    (vscode.workspace.getConfiguration('cucumber', folder.uri).get<string[]>('features') ?? []).map(
      glob => new vscode.RelativePattern(folder, glob)
    )
  );
}

async function findInitialFiles(controller: vscode.TestController, pattern: vscode.GlobPattern) {
  for (const file of await vscode.workspace.findFiles(pattern)) {
    getOrCreateFile(controller, file);
  }
}

function startWatchingWorkspace(controller: vscode.TestController, fileChangedEmitter: vscode.EventEmitter<vscode.Uri>) {
  return getWorkspaceTestPatterns().map(pattern => {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    watcher.onDidCreate(uri => {
      getOrCreateFile(controller, uri);
      fileChangedEmitter.fire(uri);
    });

    watcher.onDidChange(async uri => {
      const { file, data } = getOrCreateFile(controller, uri);
      if (data.didResolve) {
        await data.updateFromDisk(controller, file);
      }
      fileChangedEmitter.fire(uri);
    });

    watcher.onDidDelete(uri => controller.items.delete(uri.toString()));

    return watcher;
  });
}
