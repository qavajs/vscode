"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = activate;
const vscode = __importStar(require("vscode"));
const testTree_1 = require("./testTree");
async function activate(context) {
    const controller = vscode.tests.createTestController('qavajs tests', 'qavajs tests');
    context.subscriptions.push(controller);
    const fileChangedEmitter = new vscode.EventEmitter();
    const watchingTests = new Map();
    fileChangedEmitter.event(uri => {
        if (watchingTests.has('ALL')) {
            startTestRun(new vscode.TestRunRequest(undefined, undefined, watchingTests.get('ALL'), true));
            return;
        }
        const include = [];
        let profile;
        for (const [item, thisProfile] of watchingTests) {
            const cast = item;
            if (cast.uri?.toString() === uri.toString()) {
                include.push(cast);
                profile = thisProfile;
            }
        }
        if (include.length) {
            startTestRun(new vscode.TestRunRequest(include, undefined, profile, true));
        }
    });
    const runHandler = (request, cancellation) => {
        if (!request.continuous) {
            return startTestRun(request);
        }
        if (request.include === undefined) {
            watchingTests.set('ALL', request.profile);
            cancellation.onCancellationRequested(() => watchingTests.delete('ALL'));
        }
        else {
            request.include.forEach(item => watchingTests.set(item, request.profile));
            cancellation.onCancellationRequested(() => request.include.forEach(item => watchingTests.delete(item)));
        }
    };
    const startTestRun = (request) => {
        const queue = [];
        const run = controller.createTestRun(request);
        const discoverTests = async (tests) => {
            for (const test of tests) {
                if (request.exclude?.includes(test)) {
                    continue;
                }
                const data = testTree_1.testData.get(test);
                if (data instanceof testTree_1.TestCase) {
                    run.enqueued(test);
                    queue.push({ test, data });
                }
                else {
                    if (data instanceof testTree_1.TestFile && !data.didResolve) {
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
                }
                else {
                    run.started(test);
                    await data.run(test, run);
                }
            }
            run.end();
        };
        discoverTests(request.include ?? gatherTestItems(controller.items)).then(runTestQueue);
    };
    controller.refreshHandler = async () => {
        for (const [id] of controller.items) {
            controller.items.delete(id);
        }
        ;
        await Promise.all(getWorkspaceTestPatterns().map(pattern => findInitialFiles(controller, pattern)));
    };
    controller.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, runHandler, true, undefined, true);
    controller.resolveHandler = async (item) => {
        if (!item) {
            context.subscriptions.push(...startWatchingWorkspace(controller, fileChangedEmitter));
            return;
        }
        const data = testTree_1.testData.get(item);
        if (data instanceof testTree_1.TestFile) {
            await data.updateFromDisk(controller, item);
        }
    };
    function updateNodeForDocument(e) {
        if (e.uri.scheme !== 'file') {
            return;
        }
        if (!e.uri.path.endsWith('.feature')) {
            return;
        }
        const { file, data } = getOrCreateFile(controller, e.uri);
        data.updateFromContents(controller, e.getText(), file);
    }
    getWorkspaceTestPatterns().forEach(pattern => { findInitialFiles(controller, pattern); });
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(updateNodeForDocument), vscode.workspace.onDidChangeTextDocument(e => updateNodeForDocument(e.document)));
}
function getOrCreateFile(controller, uri) {
    const existing = controller.items.get(uri.toString());
    if (existing) {
        return { file: existing, data: testTree_1.testData.get(existing) };
    }
    const file = controller.createTestItem(uri.toString(), uri.path.split('/').pop(), uri);
    controller.items.add(file);
    const data = new testTree_1.TestFile();
    testTree_1.testData.set(file, data);
    file.canResolveChildren = true;
    return { file, data };
}
function gatherTestItems(collection) {
    const items = [];
    collection.forEach(item => items.push(item));
    return items;
}
function getWorkspaceTestPatterns() {
    const config = vscode.workspace.getConfiguration('cucumber');
    const featureFiles = config.get('features');
    if (!vscode.workspace.workspaceFolders || !featureFiles) {
        return [];
    }
    return featureFiles;
}
async function findInitialFiles(controller, pattern) {
    for (const file of await vscode.workspace.findFiles(pattern)) {
        getOrCreateFile(controller, file);
    }
}
function startWatchingWorkspace(controller, fileChangedEmitter) {
    return getWorkspaceTestPatterns().map(pattern => {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidCreate(uri => {
            getOrCreateFile(controller, uri);
            fileChangedEmitter.fire(uri);
        });
        watcher.onDidChange(async (uri) => {
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
//# sourceMappingURL=testExplorer.js.map