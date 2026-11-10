/**
 * End-to-end tests running inside the VS Code Extension Host against the real qavajs project
 * in test-fixtures/project (run `npm ci` there first). Run with `npm run test:integration`.
 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { TestingApi } from '../testing';

const root = () => vscode.workspace.workspaceFolders![0].uri;
const fixture = (rel: string) => vscode.Uri.joinPath(root(), rel);

let api: TestingApi;

async function waitFor<T>(fn: () => T | undefined | Promise<T | undefined>, what: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

function children(item: vscode.TestItem): vscode.TestItem[] {
  const list: vscode.TestItem[] = [];
  item.children.forEach(c => {
    list.push(c);
  });
  return list;
}

function findByLabel(item: vscode.TestItem, label: string): vscode.TestItem | undefined {
  if (item.label === label) {
    return item;
  }
  for (const child of children(item)) {
    const found = findByLabel(child, label);
    if (found) {
      return found;
    }
  }
  return undefined;
}

async function fileItem(rel: string): Promise<vscode.TestItem> {
  const uri = fixture(rel).toString();
  const item = await waitFor(() => api.controller.items.get(uri), `test item for ${rel}`);
  await api.controller.resolveHandler!(item);
  return item;
}

async function scenario(rel: string, label: string): Promise<vscode.TestItem> {
  const file = await fileItem(rel);
  const item = findByLabel(file, label);
  assert.ok(item, `scenario "${label}" in ${rel}`);
  return item;
}

function profile(name: string, kind = vscode.TestRunProfileKind.Run): vscode.TestRunProfile {
  const found = api.runProfiles().find(p => p.label === name && p.kind === kind);
  assert.ok(found, `run profile ${name} (${vscode.TestRunProfileKind[kind]})`);
  return found;
}

interface ItemResult {
  states: string[];
  messages: vscode.TestMessage[];
  duration?: number;
}

interface RunResult {
  final(item: vscode.TestItem): string | undefined;
  result(item: vscode.TestItem): ItemResult;
  output: { text: string; testId?: string }[];
  outputText: string;
}

const STATES = new Set(['enqueued', 'started', 'skipped', 'passed', 'failed', 'errored']);

async function run(
  items: vscode.TestItem[],
  profileName = 'Default',
  options: { kind?: vscode.TestRunProfileKind; cancelWhen?: (call: { method: string; args: unknown[] }) => boolean } = {}
): Promise<RunResult> {
  const p = profile(profileName, options.kind);
  const results = new Map<string, ItemResult>();
  const output: { text: string; testId?: string }[] = [];
  const cts = new vscode.CancellationTokenSource();
  const sub = api.onRunCall((_run, call) => {
    if (STATES.has(call.method)) {
      const item = call.args[0] as vscode.TestItem;
      const r = results.get(item.id) ?? { states: [], messages: [] };
      r.states.push(call.method);
      if (call.method === 'failed' || call.method === 'errored') {
        const messages = call.args[1] as vscode.TestMessage | vscode.TestMessage[];
        r.messages.push(...(Array.isArray(messages) ? messages : [messages]));
        r.duration = call.args[2] as number | undefined;
      } else if (call.method === 'passed') {
        r.duration = call.args[1] as number | undefined;
      }
      results.set(item.id, r);
    } else if (call.method === 'appendOutput') {
      output.push({ text: call.args[0] as string, testId: (call.args[2] as vscode.TestItem | undefined)?.id });
    }
    if (options.cancelWhen?.(call)) {
      cts.cancel();
    }
  });
  try {
    await p.runHandler(new vscode.TestRunRequest(items, undefined, p), cts.token);
  } finally {
    sub.dispose();
    cts.dispose();
  }
  return {
    final: item => results.get(item.id)?.states.at(-1),
    result: item => results.get(item.id) ?? { states: [], messages: [] },
    output,
    outputText: output.map(o => o.text).join(''),
  };
}

const messageText = (m: vscode.TestMessage) => (typeof m.message === 'string' ? m.message : m.message.value);

before(async () => {
  const extension = vscode.extensions.getExtension('qavajs.qavajs');
  assert.ok(extension, 'extension is installed');
  const exports = (await extension.activate()) as { testing: TestingApi };
  api = exports.testing;
});

describe('test discovery', () => {
  it('builds the tree with outline rows, rules and tags', async () => {
    const file = await fileItem('features/basic.feature');
    const feature = children(file)[0];
    assert.equal(feature.label, 'Basic');
    assert.deepEqual(
      children(feature).map(c => c.label),
      ['passes', 'fails with diff', 'flaky', 'hook breaks', 'undefined step', 'row <n>']
    );
    const outline = findByLabel(feature, 'row <n>')!;
    assert.deepEqual(children(outline).map(c => c.label), ['row 1', 'row 2']);

    const tagIds = (item: vscode.TestItem) => item.tags.map(t => t.id).sort();
    assert.deepEqual(tagIds(findByLabel(feature, 'passes')!), ['basic', 'smoke']);
    assert.deepEqual(tagIds(findByLabel(feature, 'row 1')!), ['basic', 'rows']);

    const nested = await fileItem('features/nested/other.feature');
    assert.equal(nested.description, 'features/nested');
    assert.ok(findByLabel(nested, 'env and tags'), 'rule node');
  });

  it('exposes a run and a debug profile per launch profile', () => {
    const labels = api.runProfiles().map(p => `${p.label}:${vscode.TestRunProfileKind[p.kind]}`);
    assert.deepEqual(labels, ['Default:Run', 'Default:Debug', 'Smoke:Run', 'Smoke:Debug', 'Env:Run', 'Env:Debug']);
  });
});

describe('running tests', () => {
  it('reports a passing scenario with duration and step output linked to it', async () => {
    const item = await scenario('features/basic.feature', 'passes');
    const r = await run([item]);
    assert.equal(r.final(item), 'passed');
    assert.equal(typeof r.result(item).duration, 'number');
    const linked = r.output.filter(o => o.testId === item.id).map(o => o.text).join('');
    assert.match(linked, /When I log 'hello'/);
    assert.match(linked, /log: hello/, 'console.log is attributed to the scenario');
  });

  it('puts the failure on the failing step with a diff, stack frames and the screenshot', async () => {
    const item = await scenario('features/basic.feature', 'fails with diff');
    const r = await run([item]);
    assert.equal(r.final(item), 'failed');
    const [failure, ...rest] = r.result(item).messages;
    assert.match(messageText(failure), /expected 'admin' to equal 'root'/);
    assert.equal(failure.location?.range.start.line, 12, 'line of "Then I expect ..."');
    assert.equal(failure.expectedOutput, "'root'");
    assert.equal(failure.actualOutput, "'admin'");
    assert.ok(failure.stackTrace?.some(f => f.uri?.path.endsWith('step_definition/steps.js')), 'stack frame into steps.js');
    assert.ok(rest.some(m => /\.png/.test(messageText(m))), 'attachment message links the screenshot');
    assert.match(r.outputText, /retrying/);
    assert.match(messageText(failure), /failed on all 2 attempts/);
  });

  it('flags a scenario that passes after a retry', async () => {
    const item = await scenario('features/basic.feature', 'flaky');
    const r = await run([item]);
    assert.equal(r.final(item), 'passed');
    assert.match(r.outputText, /flaky: passed after 1 retry/);
  });

  it('points a hook failure at the hook source', async () => {
    const item = await scenario('features/basic.feature', 'hook breaks');
    const r = await run([item]);
    assert.equal(r.final(item), 'failed');
    const location = r.result(item).messages[0].location;
    assert.ok(location?.uri.path.endsWith('step_definition/steps.js'), String(location?.uri));
  });

  it('reports undefined steps', async () => {
    const item = await scenario('features/basic.feature', 'undefined step');
    const r = await run([item]);
    assert.equal(r.final(item), 'failed');
    assert.match(messageText(r.result(item).messages[0]), /Undefined step: When nobody implemented this/);
  });

  it('reports outline rows individually and derives the outline status', async () => {
    const outline = await scenario('features/basic.feature', 'row <n>');
    const [row1, row2] = children(outline);
    const r = await run([outline]);
    assert.equal(r.final(row1), 'passed');
    assert.equal(r.final(row2), 'failed');
    assert.equal(r.final(outline), 'failed');
    assert.match(messageText(r.result(outline).messages[0]), /1 failed of 2/);
  });

  it('runs selected tests of several files in one process', async () => {
    const basic = await fileItem('features/basic.feature');
    const env = await scenario('features/nested/other.feature', 'env from profile');
    const r = await run([basic, env]);
    const commands = r.output.filter(o => o.text.includes('--format message'));
    assert.equal(commands.length, 1, `one command, got:\n${commands.map(c => c.text).join('')}`);
    assert.equal(r.final(findByLabel(basic, 'passes')!), 'passed');
    assert.equal(r.final(env), 'failed', 'the Default profile does not set QAVAJS_FIXTURE');
    assert.equal(r.final(children(basic)[0]), 'failed', 'feature status derived from scenarios');
  });

  it('passes env from the launch profile', async () => {
    const env = await scenario('features/nested/other.feature', 'env from profile');
    assert.equal((await run([env], 'Env')).final(env), 'passed');
  });

  it('filters by the launch profile tags', async () => {
    const basic = await fileItem('features/basic.feature');
    const r = await run([basic], 'Smoke');
    assert.match(r.outputText, /--tags '@smoke'/);
    assert.equal(r.final(findByLabel(basic, 'passes')!), 'passed');
    assert.equal(r.final(findByLabel(basic, 'fails with diff')!), 'skipped');
  });

  it('cancels a running scenario and stops the process', async () => {
    const slow = await scenario('features/nested/other.feature', 'slow');
    const started = Date.now();
    // cancel once qavajs reports the scenario as running, so the process (not just the queue) is stopped
    const r = await run([slow], 'Default', {
      cancelWhen: call => call.method === 'appendOutput' && String(call.args[0]).includes('▶ slow'),
    });
    assert.equal(r.final(slow), 'skipped');
    assert.ok(Date.now() - started < 30_000, `run took ${Date.now() - started} ms; the scenario waits 60 s`);
  });

  it('debugs a scenario', async () => {
    const item = await scenario('features/basic.feature', 'passes');
    const r = await run([item], 'Default', { kind: vscode.TestRunProfileKind.Debug });
    assert.equal(r.final(item), 'passed', r.outputText);
    assert.match(r.outputText, /--format '?message:/);
  });
});

describe('language features', () => {
  const openBasic = async () => vscode.workspace.openTextDocument(fixture('features/basic.feature'));

  it('shows step definition docs on hover', async () => {
    const doc = await openBasic();
    const line = doc.getText().split('\n').findIndex(l => l.includes("When I log 'hello'"));
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, new vscode.Position(line, 10));
    const text = hovers.flatMap(h => h.contents.map(c => (typeof c === 'string' ? c : c.value))).join('\n');
    assert.match(text, /Logs a value to stdout/);
    assert.match(text, /steps\.js:\d+/);
  });

  it('provides folding ranges', async () => {
    const doc = await openBasic();
    const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', doc.uri);
    const has = (start: number, end: number) => ranges.some(r => r.start === start && r.end === end);
    assert.ok(has(3, 4), 'Background');
    assert.ok(has(28, 31), 'Examples');
  });

  it('finds scenarios with workspace symbol search', async () => {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', 'flaky');
    assert.ok(symbols.some(s => s.name === 'Scenario: flaky' && s.location.uri.path.endsWith('basic.feature')));
  });

  it('completes steps from the glue files (language server)', async () => {
    const doc = await openBasic();
    const line = doc.getText().split('\n').findIndex(l => l.includes("When I log 'hello'"));
    const list = await waitFor(async () => {
      const result = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        doc.uri,
        new vscode.Position(line, '    When I l'.length)
      );
      return result.items.some(i => (typeof i.label === 'string' ? i.label : i.label.label).startsWith('I log')) ? result : undefined;
    }, 'step completion');
    assert.ok(list.items.length > 0);
  });

  it('reports gherkin syntax errors but not undefined steps', async () => {
    const doc = await openBasic();
    const editor = await vscode.window.showTextDocument(doc);
    try {
      // break the syntax in memory only; the file on disk is untouched
      await editor.edit(e => e.insert(new vscode.Position(doc.lineCount, 0), '\n  Scenario without colon\n'));
      const diagnostics = await waitFor(() => {
        const d = vscode.languages.getDiagnostics(doc.uri);
        return d.length ? d : undefined;
      }, 'gherkin diagnostics');
      assert.ok(
        diagnostics.every(d => d.code !== 'cucumber.undefined-step'),
        diagnostics.map(d => `${d.code}: ${d.message}`).join('\n')
      );
    } finally {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });
});
