import * as vscode from 'vscode';
import { TestCase, TestFeature, testData, TestFile } from './testTree';

export default async function activate(context: vscode.ExtensionContext) {
  const controller = vscode.tests.createTestController('qavajs tests', 'qavajs tests');
  context.subscriptions.push(controller);

  const fileChangedEmitter = new vscode.EventEmitter<vscode.Uri>();
  const watchingTests = new Map<vscode.TestItem | 'ALL', vscode.TestRunProfile | undefined>();
  fileChangedEmitter.event(uri => {
    if (watchingTests.has('ALL')) {
      startTestRun(new vscode.TestRunRequest(undefined, undefined, watchingTests.get('ALL'), true));
      return;
    }
    const include: vscode.TestItem[] = [];
    let profile: vscode.TestRunProfile | undefined;
    for (const [item, thisProfile] of watchingTests) {
      const cast = item as vscode.TestItem;
      if (cast.uri?.toString() === uri.toString()) {
        include.push(cast);
        profile = thisProfile;
      }
    }

    if (include.length) {
      startTestRun(new vscode.TestRunRequest(include, undefined, profile, true));
    }
  });

  const runHandler = (request: vscode.TestRunRequest, cancellation: vscode.CancellationToken, launchCommand?: string) => {
    if (!request.continuous) {
      return startTestRun(request, launchCommand);
    }

    if (request.include === undefined) {
      watchingTests.set('ALL', request.profile);
      cancellation.onCancellationRequested(() => watchingTests.delete('ALL'));
    } else {
      request.include.forEach(item => watchingTests.set(item, request.profile));
      cancellation.onCancellationRequested(() => request.include!.forEach(item => watchingTests.delete(item)));
    }
  };

  const startTestRun = (request: vscode.TestRunRequest, launchCommand?: string) => {
    const queue: { test: vscode.TestItem; data: TestCase | TestFeature }[] = [];
    const run = controller.createTestRun(request);

    const enqueueDescendants = (parent: vscode.TestItem) => {
      parent.children.forEach(child => {
        run.enqueued(child);
        enqueueDescendants(child);
      });
    };

    const discoverTests = async (tests: Iterable<vscode.TestItem>) => {
      for (const test of tests) {
        if (request.exclude?.includes(test)) {
          continue;
        }
        const data = testData.get(test);
        if (data instanceof TestCase) {
          run.enqueued(test);
          queue.push({ test, data });
        } else if (data instanceof TestFeature) {
          run.enqueued(test);
          enqueueDescendants(test);
          queue.push({ test, data });
        } else {
          if (data instanceof TestFile && !data.didResolve) {
            await data.updateFromDisk(controller, test);
          }
          await discoverTests(gatherTestItems(test.children));
        }
      }
    };

    const runTestQueue = async () => {
      for (const { test, data } of queue) {
        if (run.token.isCancellationRequested) {
          run.skipped(test);
        } else {
          run.started(test);
          await data.run(test, run, launchCommand);
        }
      }
      run.end();
    };

    discoverTests(request.include ?? gatherTestItems(controller.items)).then(runTestQueue);
  };

  controller.refreshHandler = async () => {
    for (const [id] of controller.items) {
      controller.items.delete(id);
    };
    await Promise.all(getWorkspaceTestPatterns().map(pattern => findInitialFiles(controller, pattern)));
  };

  const createRunProfiles = (): vscode.Disposable[] => {
    const profiles: { name: string; command: string }[] =
      vscode.workspace.getConfiguration('qavajs').get('launchProfiles') ?? [];

    if (profiles.length === 0) {
      return [
        controller.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run,
          (req, token) => runHandler(req, token), true, undefined, true)
      ];
    }

    return profiles.map((profile, i) =>
      controller.createRunProfile(profile.name, vscode.TestRunProfileKind.Run,
        (req, token) => runHandler(req, token, profile.command), i === 0, undefined, i === 0)
    );
  };

  let profileDisposables = createRunProfiles();
  context.subscriptions.push(...profileDisposables);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('qavajs.launchProfiles') || e.affectsConfiguration('qavajs.launchCommand')) {
        profileDisposables.forEach(d => d.dispose());
        profileDisposables = createRunProfiles();
        context.subscriptions.push(...profileDisposables);
      }
    })
  );

  controller.resolveHandler = async item => {
    if (!item) {
      context.subscriptions.push(...startWatchingWorkspace(controller, fileChangedEmitter));
      return;
    }

    const data = testData.get(item);
    if (data instanceof TestFile) {
      await data.updateFromDisk(controller, item);
    }
  };

  function updateNodeForDocument(e: vscode.TextDocument) {
    if (e.uri.scheme !== 'file') {
      return;
    }

    if (!e.uri.path.endsWith('.feature')) {
      return;
    }

    const { file, data } = getOrCreateFile(controller, e.uri);
    data.updateFromContents(controller, e.getText(), file);
  }

  getWorkspaceTestPatterns().forEach(pattern => { findInitialFiles(controller, pattern) });

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(updateNodeForDocument),
    vscode.workspace.onDidChangeTextDocument(e => updateNodeForDocument(e.document)),
  );
}

function getOrCreateFile(controller: vscode.TestController, uri: vscode.Uri) {
  const existing = controller.items.get(uri.toString());
  if (existing) {
    return { file: existing, data: testData.get(existing) as TestFile };
  }

  const file = controller.createTestItem(uri.toString(), uri.path.split('/').pop()!, uri);
  controller.items.add(file);

  const data = new TestFile();
  testData.set(file, data);

  file.canResolveChildren = true;
  return { file, data };
}

function gatherTestItems(collection: vscode.TestItemCollection) {
  const items: vscode.TestItem[] = [];
  collection.forEach(item => items.push(item));
  return items;
}

function getWorkspaceTestPatterns() {
  const config = vscode.workspace.getConfiguration('cucumber');
  const featureFiles: string[] | undefined = config.get('features');
  if (!vscode.workspace.workspaceFolders || !featureFiles) {
    return [];
  }

  return featureFiles;
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

    findInitialFiles(controller, pattern);

    return watcher;
  });
}