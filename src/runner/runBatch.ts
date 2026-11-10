import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as vscode from 'vscode';
import { gatherTestItems, leafItems, type TestNode, testData } from '../testTree';
import { parseExpectedActual, parseStackFrames } from './failure';
import type { ResolvedLaunch } from './launch';
import { type Attachment, type CaseRef, MessageStreamProcessor, type ScenarioEvent, type StepRef } from './messages';
import { buildRunCommand, chunkLocations, detectShellKind, MAX_COMMAND_LENGTH, messageFileFormat } from './shell';

const STDERR_TAIL_LIMIT = 4000;
const DEBUG_POLL_MS = 200;

export interface BatchTarget {
  item: vscode.TestItem;
  node: TestNode;
}

export interface BatchOptions {
  launch: ResolvedLaunch;
  folder?: vscode.WorkspaceFolder;
  debug: boolean;
  /** Directory where binary attachments (screenshots, videos) of this run are saved. */
  attachmentsDir: vscode.Uri;
  /** Cancelled when the run or the run request is cancelled. */
  token: vscode.CancellationToken;
}

type Result =
  | { status: 'passed'; durationMs?: number }
  | { status: 'skipped' }
  | { status: 'failed' | 'errored'; message: string; durationMs?: number; failedStep?: StepRef };

const crlf = (text: string) => text.replace(/\r?\n/g, '\r\n');

const normalizePath = (p: string) => {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const STATUS_ICON: Record<string, string> = {
  PASSED: '✔',
  FAILED: '✖',
  SKIPPED: '-',
  PENDING: '?',
  UNDEFINED: '?',
  AMBIGUOUS: '!',
};

/** Runs all targets of one workspace folder in as few processes as the shell allows. */
export async function runBatch(targets: BatchTarget[], run: vscode.TestRun, options: BatchOptions): Promise<void> {
  const kind = detectShellKind(vscode.env.shell);
  const byLocation = new Map<string, BatchTarget>();
  for (const target of targets) {
    byLocation.set(target.node.location(target.item), target);
  }
  const maxLength = process.platform === 'win32' ? MAX_COMMAND_LENGTH.win32 : MAX_COMMAND_LENGTH.other;
  const chunks = chunkLocations(options.launch.command, [...byLocation.keys()], kind, maxLength, { tags: options.launch.tags });
  for (const chunk of chunks) {
    if (options.token.isCancellationRequested) {
      for (const loc of chunk) {
        for (const leaf of leafItems(byLocation.get(loc)!.item)) {
          run.skipped(leaf);
        }
      }
      continue;
    }
    await new BatchRun(chunk.map(loc => byLocation.get(loc)!), run, options, chunk).execute();
  }
}

class BatchRun {
  private readonly leaves: vscode.TestItem[];
  private readonly leafByKey = new Map<string, vscode.TestItem>();
  /** Normalized feature paths of this batch, for suffix matching of reported uris. */
  private readonly files: string[];
  private readonly started = new Set<vscode.TestItem>();
  private readonly results = new Map<vscode.TestItem, Result>();
  private readonly retries = new Map<vscode.TestItem, number>();
  private readonly attachments = new Map<vscode.TestItem, { name: string; uri: vscode.Uri; mediaType: string }[]>();
  private readonly pendingWrites: Promise<unknown>[] = [];
  private readonly processor: MessageStreamProcessor;
  private attachmentCount = 0;
  private stderrTail = '';

  constructor(
    private readonly targets: BatchTarget[],
    private readonly run: vscode.TestRun,
    private readonly options: BatchOptions,
    private readonly locations: string[]
  ) {
    this.leaves = targets.flatMap(t => leafItems(t.item));
    const files = new Set<string>();
    for (const leaf of this.leaves) {
      const node = testData.get(leaf) as TestNode;
      files.add(normalizePath(node.fsPath));
      this.leafByKey.set(`${normalizePath(node.fsPath)}:${node.line}`, leaf);
    }
    this.files = [...files];
    this.processor = new MessageStreamProcessor(
      event => this.onEvent(event),
      text => this.output(`${text}\n`, this.processor.currentCase())
    );
  }

  async execute(): Promise<void> {
    const failure = this.options.debug ? await this.runDebug() : await this.runProcess();
    this.processor.end();
    await Promise.allSettled(this.pendingWrites);
    this.finish(failure);
  }

  private command(format?: string) {
    const kind = detectShellKind(vscode.env.shell);
    return buildRunCommand(this.options.launch.command, this.locations, kind, { tags: this.options.launch.tags, format });
  }

  // ---------------------------------------------------------------- process

  private runProcess(): Promise<string | undefined> {
    const command = this.command();
    const { cwd, env } = this.options.launch;
    this.run.appendOutput(crlf(`${command}\n`));

    return new Promise(resolve => {
      let proc: ChildProcess | undefined;
      let settled = false;
      const done = (failure?: string) => {
        if (!settled) {
          settled = true;
          cancelListener.dispose();
          resolve(failure);
        }
      };
      const cancelListener = this.options.token.onCancellationRequested(() => {
        if (proc) {
          killTree(proc);
        }
      });

      try {
        proc = spawn(command, {
          cwd,
          env: { ...process.env, ...env },
          shell: vscode.env.shell || true,
          stdio: ['ignore', 'pipe', 'pipe'],
          // own process group on POSIX so cancellation can kill npx -> node -> browsers
          detached: process.platform !== 'win32',
          windowsHide: true,
        });
      } catch (e) {
        const message = `Failed to start: ${(e as Error).message}`;
        this.run.appendOutput(crlf(`${message}\n`));
        done(message);
        return;
      }

      proc.stdout!.on('data', (chunk: Buffer) => this.processor.write(chunk.toString()));
      proc.stderr!.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_LIMIT);
        this.output(text, this.processor.currentCase());
      });
      proc.on('error', err => {
        const message = `Failed to run "${command}": ${err.message}`;
        this.run.appendOutput(crlf(`${message}\n`));
        done(message);
      });
      proc.on('close', (code, signal) => {
        if (this.options.token.isCancellationRequested) {
          done('Run cancelled');
        } else if (code !== 0 && this.results.size === 0) {
          const tail = this.stderrTail.trim();
          done(`Process exited with ${signal ? `signal ${signal}` : `code ${code}`}${tail ? `\n\n${tail}` : ''}`);
        } else {
          done(code === 0 ? undefined : `Process exited with code ${code}`);
        }
      });
    });
  }

  // ---------------------------------------------------------------- debug

  /**
   * Debugging runs the command in a js-debug terminal (which auto-attaches to npx's node
   * children), so stdout belongs to the terminal; messages are written to a file and tailed.
   */
  private async runDebug(): Promise<string | undefined> {
    const messagesFile = path.join(os.tmpdir(), `qavajs-${randomUUID()}.ndjson`);
    await fsp.writeFile(messagesFile, '');
    const command = this.command(messageFileFormat(messagesFile));
    const { cwd, env } = this.options.launch;
    const name = `qavajs: ${this.targets.length === 1 ? this.targets[0].item.label : `${this.targets.length} tests`}`;
    const sessionId = randomUUID();
    this.run.appendOutput(crlf(`${command}\nDebugging: test output is shown in the "${name}" terminal.\n`));

    let session: vscode.DebugSession | undefined;
    // js-debug keeps the parent node-terminal session (and its terminal) alive after the command
    // exits, so completion is detected from shell integration, the end of the message stream,
    // or the user stopping the session.
    let finish!: (outcome: { exitCode?: number; stopped?: boolean }) => void;
    const finished = new Promise<{ exitCode?: number; stopped?: boolean }>(resolve => {
      finish = resolve;
    });
    let runFinished = false;
    const disposables: vscode.Disposable[] = [
      vscode.debug.onDidStartDebugSession(s => {
        if (!session && s.configuration.__qavajsSession === sessionId) {
          session = s;
        }
      }),
      vscode.debug.onDidTerminateDebugSession(s => {
        if (s === session) {
          finish({ stopped: true });
        }
      }),
      vscode.window.onDidEndTerminalShellExecution(e => {
        // the messages file path makes the command line unique to this run
        if (e.execution.commandLine.value.includes(messagesFile)) {
          finish({ exitCode: e.exitCode });
        }
      }),
      this.options.token.onCancellationRequested(() => finish({ stopped: true })),
    ];

    let offset = 0;
    let reading = Promise.resolve();
    const readNew = () => {
      reading = reading.then(async () => {
        const handle = await fsp.open(messagesFile, 'r').catch(() => undefined);
        if (!handle) {
          return;
        }
        try {
          const { size } = await handle.stat();
          if (size > offset) {
            const buffer = Buffer.alloc(size - offset);
            await handle.read(buffer, 0, buffer.length, offset);
            offset = size;
            const text = buffer.toString('utf8');
            this.processor.write(text);
            if (!runFinished && text.includes('"testRunFinished"')) {
              runFinished = true;
              finish({});
            }
          }
        } finally {
          await handle.close();
        }
      });
      return reading;
    };
    const poll = setInterval(readNew, DEBUG_POLL_MS);

    try {
      const ok = await vscode.debug.startDebugging(
        this.options.folder,
        { type: 'node-terminal', request: 'launch', name, command, cwd, env, __qavajsSession: sessionId },
        { testRun: this.run }
      );
      if (!ok) {
        return 'Failed to start the debug session (is the JavaScript Debugger extension enabled?)';
      }
      if (!session && vscode.debug.activeDebugSession?.configuration.__qavajsSession === sessionId) {
        session = vscode.debug.activeDebugSession;
      }
      const outcome = await finished;
      if (this.options.token.isCancellationRequested) {
        return 'Run cancelled';
      }
      if (outcome.stopped && !runFinished) {
        return 'Debug session was stopped';
      }
      if (outcome.exitCode !== undefined && outcome.exitCode !== 0 && this.results.size === 0) {
        return `Process exited with code ${outcome.exitCode}; see the "${name}" terminal`;
      }
      return undefined;
    } finally {
      clearInterval(poll);
      await readNew();
      for (const d of disposables) {
        d.dispose();
      }
      if (session) {
        void vscode.debug.stopDebugging(session);
      }
      await fsp.rm(messagesFile, { force: true });
    }
  }

  // ---------------------------------------------------------------- events

  private itemFor(ref: CaseRef | undefined): vscode.TestItem | undefined {
    if (!ref) {
      return undefined;
    }
    const file = normalizePath(ref.uri.startsWith('file:') ? fileURLToPath(ref.uri) : path.resolve(this.options.launch.cwd, ref.uri));
    const exact = this.leafByKey.get(`${file}:${ref.line}`);
    if (exact || ref.uri.startsWith('file:') || path.isAbsolute(ref.uri)) {
      return exact;
    }
    // the config may change cucumber's cwd: match the reported relative uri as a path suffix.
    // Scenarios of files outside this batch (qavajs merges config `paths` with --paths) never match.
    const suffix = normalizePath(path.resolve('/', ref.uri)).replace(/^[a-z]:/i, '');
    const candidates = this.files.filter(f => f.endsWith(suffix));
    return candidates.length === 1 ? this.leafByKey.get(`${candidates[0]}:${ref.line}`) : undefined;
  }

  private location(item: vscode.TestItem, line?: number): vscode.Location | undefined {
    if (!item.uri) {
      return undefined;
    }
    const l = Math.max(0, (line ?? (testData.get(item) as TestNode).line) - 1);
    return new vscode.Location(item.uri, new vscode.Position(l, 0));
  }

  private output(text: string, ref?: CaseRef, line?: number) {
    const item = this.itemFor(ref);
    this.run.appendOutput(crlf(text), item ? this.location(item, line) : undefined, item);
  }

  private onEvent(event: ScenarioEvent) {
    const item = this.itemFor(event.case);
    if (!item) {
      return;
    }
    switch (event.type) {
      case 'started': {
        this.started.add(item);
        this.run.started(item);
        const prefix = event.attempt > 0 ? `↻ Retry #${event.attempt}: ` : '▶ ';
        this.output(`${prefix}${event.case.name}\n`, event.case);
        return;
      }
      case 'step': {
        const label = event.step.kind === 'step' ? `${event.step.keyword} ${event.step.text}` : `Hook ${event.step.name ?? ''}`.trim();
        const icon = STATUS_ICON[event.status] ?? event.status;
        const duration = event.durationMs !== undefined && event.status !== 'SKIPPED' ? ` (${formatDuration(event.durationMs)})` : '';
        const line = event.step.kind === 'step' ? event.step.line : undefined;
        this.output(`  ${icon} ${label}${duration}\n`, event.case, line);
        return;
      }
      case 'attachment':
        this.onAttachment(item, event.case, event.attachment);
        return;
      case 'finished': {
        if (event.willBeRetried) {
          this.retries.set(item, (this.retries.get(item) ?? 0) + 1);
          this.output(`  attempt ${event.attempt + 1} ${event.status}, retrying\n`, event.case);
          return;
        }
        const previous = this.results.get(item);
        // keep the first failure if a scenario is reported more than once
        if (previous?.status === 'failed') {
          return;
        }
        let result: Result;
        if (event.status === 'failed') {
          result = { status: 'failed', message: event.message ?? 'Scenario failed', durationMs: event.durationMs, failedStep: event.failedStep };
        } else if (event.status === 'passed') {
          result = { status: 'passed', durationMs: event.durationMs };
          const retries = this.retries.get(item);
          if (retries) {
            this.output(`  ⚠ flaky: passed after ${retries} ${retries === 1 ? 'retry' : 'retries'}\n`, event.case);
          }
        } else {
          result = previous ?? { status: 'skipped' };
        }
        this.results.set(item, result);
        this.report(item, result);
        return;
      }
    }
  }

  private onAttachment(item: vscode.TestItem, ref: CaseRef, a: Attachment) {
    if (a.url) {
      this.output(`    📎 ${a.fileName ?? a.mediaType}: ${a.url}\n`, ref);
      return;
    }
    const isText = a.mediaType.startsWith('text/') || a.mediaType === 'application/json';
    if (isText) {
      const text = a.encoding === 'BASE64' ? Buffer.from(a.body, 'base64').toString('utf8') : a.body;
      this.output(`${text.replace(/^/gm, '    ')}\n`, ref);
      return;
    }
    const index = ++this.attachmentCount;
    const name = sanitizeFileName(a.fileName ?? `attachment-${index}${extensionFor(a.mediaType)}`);
    const uri = vscode.Uri.joinPath(this.options.attachmentsDir, `${index}-${name}`);
    const data = a.encoding === 'BASE64' ? Buffer.from(a.body, 'base64') : Buffer.from(a.body, 'utf8');
    this.pendingWrites.push(
      Promise.resolve(vscode.workspace.fs.writeFile(uri, data)).then(
        () => {
          const list = this.attachments.get(item) ?? [];
          list.push({ name, uri, mediaType: a.mediaType });
          this.attachments.set(item, list);
          this.output(`    📎 ${name}: ${uri.fsPath}\n`, ref);
        },
        e => this.output(`    failed to save attachment ${name}: ${(e as Error).message}\n`, ref)
      )
    );
  }

  private finish(failure?: string) {
    const noResults = this.results.size === 0;
    for (const leaf of this.leaves) {
      if (this.results.has(leaf)) {
        // attachments are written asynchronously, so they are added to failures once all are saved
        // (messages of repeated failed() calls accumulate)
        const result = this.results.get(leaf)!;
        const attachmentMessage = result.status === 'failed' ? this.attachmentMessage(leaf, result) : undefined;
        if (attachmentMessage && result.status === 'failed') {
          this.run.failed(leaf, attachmentMessage, result.durationMs);
        }
        continue;
      }
      let result: Result;
      if (this.options.token.isCancellationRequested) {
        result = { status: 'skipped' };
      } else if (failure && noResults) {
        result = { status: 'errored', message: failure };
      } else if (this.started.has(leaf)) {
        result = { status: 'errored', message: failure ?? 'Process exited before the scenario finished' };
      } else {
        result = { status: 'skipped' };
      }
      this.results.set(leaf, result);
      this.report(leaf, result);
    }
    for (const target of this.targets) {
      this.reportContainers(target.item);
    }
  }

  private report(item: vscode.TestItem, result: Result) {
    switch (result.status) {
      case 'passed':
        return this.run.passed(item, result.durationMs);
      case 'skipped':
        return this.run.skipped(item);
      case 'failed':
        return this.run.failed(item, this.failureMessages(item, result), result.durationMs);
      case 'errored':
        return this.run.errored(item, this.failureMessages(item, result), result.durationMs);
    }
  }

  private failureMessages(item: vscode.TestItem, result: Extract<Result, { message: string }>): vscode.TestMessage[] {
    let text = result.message;
    const retries = this.retries.get(item);
    if (retries) {
      text += `\n\n(failed on all ${retries + 1} attempts)`;
    }
    const diff = parseExpectedActual(result.message);
    const message = diff ? vscode.TestMessage.diff(text, diff.expected, diff.actual) : new vscode.TestMessage(text);
    message.location = this.failureLocation(item, result.failedStep);
    const frames = parseStackFrames(result.message).map(f => {
      const uri = f.file.startsWith('file:') ? vscode.Uri.parse(f.file) : vscode.Uri.file(f.file);
      return new vscode.TestMessageStackFrame(f.label, uri, new vscode.Position(Math.max(0, f.line - 1), Math.max(0, f.column - 1)));
    });
    if (frames.length) {
      message.stackTrace = frames;
    }
    return [message];
  }

  private attachmentMessage(item: vscode.TestItem, result: Extract<Result, { message: string }>): vscode.TestMessage | undefined {
    const attachments = this.attachments.get(item);
    if (!attachments?.length) {
      return undefined;
    }
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown('**Attachments**\n\n');
    for (const a of attachments) {
      const link = a.uri.toString();
      if (a.mediaType.startsWith('image/')) {
        md.appendMarkdown(`[${escapeMarkdown(a.name)}](${link})\n\n![${escapeMarkdown(a.name)}](${link})\n\n`);
      } else {
        md.appendMarkdown(`- [${escapeMarkdown(a.name)}](${link})\n`);
      }
    }
    const message = new vscode.TestMessage(md);
    message.location = this.failureLocation(item, result.failedStep);
    return message;
  }

  /** The failing step's line; a failing hook points at its source; otherwise the scenario. */
  private failureLocation(item: vscode.TestItem, step: StepRef | undefined): vscode.Location | undefined {
    if (step?.kind === 'step' && step.line) {
      return this.location(item, step.line);
    }
    if (step?.kind === 'hook' && step.uri && step.line) {
      const file = step.uri.startsWith('file:') ? fileURLToPath(step.uri) : path.resolve(this.options.launch.cwd, step.uri);
      return new vscode.Location(vscode.Uri.file(file), new vscode.Position(step.line - 1, 0));
    }
    return this.location(item);
  }

  /** Derives outline / rule / feature status from their children (post-order). */
  private reportContainers(item: vscode.TestItem): Result | undefined {
    if (this.results.has(item)) {
      return this.results.get(item);
    }
    const childResults = gatherTestItems(item.children)
      .map(child => this.reportContainers(child))
      .filter((r): r is Result => r !== undefined);
    if (childResults.length === 0) {
      return undefined;
    }

    const durationMs = childResults.reduce((sum, r) => sum + ('durationMs' in r ? (r.durationMs ?? 0) : 0), 0) || undefined;
    const failed = childResults.filter(r => r.status === 'failed').length;
    const errored = childResults.filter(r => r.status === 'errored').length;
    let result: Result;
    if (failed || errored) {
      const parts = [failed && `${failed} failed`, errored && `${errored} errored`].filter(Boolean).join(', ');
      result = { status: failed ? 'failed' : 'errored', message: `${parts} of ${childResults.length}`, durationMs };
    } else if (childResults.some(r => r.status === 'passed')) {
      result = { status: 'passed', durationMs };
    } else {
      result = { status: 'skipped' };
    }
    this.results.set(item, result);
    if (result.status === 'failed' || result.status === 'errored') {
      const message = new vscode.TestMessage(result.message);
      message.location = this.location(item);
      this.run[result.status](item, message, result.durationMs);
    } else {
      this.report(item, result);
    }
    return result;
  }
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function extensionFor(mediaType: string): string {
  const known: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'video/webm': '.webm',
    'video/mp4': '.mp4',
    'application/zip': '.zip',
    'application/pdf': '.pdf',
    'text/html': '.html',
  };
  return known[mediaType] ?? '';
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 100) || 'attachment';
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
}

function killTree(proc: ChildProcess) {
  if (proc.pid === undefined || proc.exitCode !== null) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-proc.pid, 'SIGTERM');
    }
  } catch {
    proc.kill();
  }
}
