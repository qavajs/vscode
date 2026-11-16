/**
 * Pure (vscode-free) processing of the cucumber `--format message` NDJSON stream.
 * Translates envelopes into per-scenario events keyed by the feature uri and the gherkin
 * line of the scenario (or of the example row, for Scenario Outlines).
 */

export type ScenarioStatus = 'passed' | 'failed' | 'skipped';

/** A scenario (or outline example row) as identified in the stream. */
export interface CaseRef {
  /** Feature uri as reported by cucumber (usually relative to the process cwd). */
  uri: string;
  line: number;
  name: string;
}

export type StepRef =
  | { kind: 'step'; keyword: string; text: string; line?: number }
  | { kind: 'hook'; name?: string; uri?: string; line?: number };

export interface Attachment {
  mediaType: string;
  /** Raw body; base64 when `encoding` is `BASE64`. */
  body: string;
  encoding: 'BASE64' | 'IDENTITY';
  fileName?: string;
  url?: string;
}

export type ScenarioEvent =
  | { type: 'started'; case: CaseRef; attempt: number }
  | { type: 'step'; case: CaseRef; step: StepRef; status: string; durationMs?: number; message?: string }
  | { type: 'attachment'; case: CaseRef; attachment: Attachment }
  | {
      type: 'finished';
      case: CaseRef;
      status: ScenarioStatus;
      /** 0-based attempt number; > 0 means the scenario was retried. */
      attempt: number;
      /** True when this attempt failed and cucumber will run the scenario again. */
      willBeRetried: boolean;
      durationMs?: number;
      message?: string;
      failedStep?: StepRef;
    };

const ENVELOPE_KEYS = new Set([
  'meta', 'source', 'gherkinDocument', 'pickle', 'stepDefinition', 'hook', 'parameterType', 'undefinedParameterType',
  'testRunStarted', 'testRunFinished', 'testCase', 'testCaseStarted', 'testCaseFinished', 'testStepStarted',
  'testStepFinished', 'testRunHookStarted', 'testRunHookFinished', 'attachment', 'externalAttachment', 'suggestion',
]);

const STATUS_PRIORITY = ['FAILED', 'AMBIGUOUS', 'UNDEFINED', 'PENDING', 'SKIPPED', 'PASSED'];

export function worstStepStatus(statuses: readonly string[]): string {
  for (const s of STATUS_PRIORITY) {
    if (statuses.includes(s)) {
      return s;
    }
  }
  return statuses[0] ?? 'UNKNOWN';
}

interface Timestamp {
  seconds: number;
  nanos: number;
}

const toMs = (t: Timestamp | undefined) => (t ? t.seconds * 1000 + t.nanos / 1e6 : undefined);

interface StepResult {
  status: string;
  message?: string;
  step?: StepRef;
}

interface ActiveCase {
  ref: CaseRef;
  attempt: number;
  startedAt?: number;
  steps: StepResult[];
}

export class MessageStreamProcessor {
  private buffer = '';
  private readonly astNodes = new Map<string, { line: number; keyword?: string }>();
  private readonly pickles = new Map<string, { uri: string; line: number; name: string }>();
  private readonly pickleSteps = new Map<string, { text: string; astNodeId?: string }>();
  private readonly hooks = new Map<string, { name?: string; uri?: string; line?: number }>();
  /** testStep id -> pickleStepId | hookId */
  private readonly testSteps = new Map<string, { pickleStepId?: string; hookId?: string }>();
  private readonly testCasePickles = new Map<string, string>();
  private readonly active = new Map<string, ActiveCase>();

  constructor(
    private readonly onEvent: (event: ScenarioEvent) => void,
    /** Receives stdout lines that are not message envelopes (e.g. console.log from tests). */
    private readonly onText?: (line: string) => void
  ) { }

  /** The only scenario currently running, if exactly one is (used to attribute output). */
  currentCase(): CaseRef | undefined {
    if (this.active.size !== 1) {
      return undefined;
    }
    return this.active.values().next().value?.ref;
  }

  /** Feed a raw chunk of stdout; complete lines are processed immediately. */
  write(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      this.processLine(line);
    }
  }

  /** Flush any trailing partial line (call on process close). */
  end(): void {
    this.processLine(this.buffer);
    this.buffer = '';
  }

  processLine(raw: string): void {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) {
      return;
    }
    let envelope: any;
    try {
      envelope = line.trimStart().startsWith('{') ? JSON.parse(line) : undefined;
    } catch {
      envelope = undefined;
    }
    if (!envelope || typeof envelope !== 'object' || !Object.keys(envelope).some(k => ENVELOPE_KEYS.has(k))) {
      // console.log of a JSON value is still test output
      this.onText?.(line);
      return;
    }

    if (envelope.gherkinDocument?.feature) {
      this.indexChildren(envelope.gherkinDocument.feature.children ?? []);
    }
    if (envelope.pickle) {
      this.indexPickle(envelope.pickle);
    }
    if (envelope.hook) {
      const { id, name, sourceReference } = envelope.hook;
      this.hooks.set(id, { name, uri: sourceReference?.uri, line: sourceReference?.location?.line });
    }
    if (envelope.testCase) {
      this.testCasePickles.set(envelope.testCase.id, envelope.testCase.pickleId);
      for (const step of envelope.testCase.testSteps ?? []) {
        this.testSteps.set(step.id, { pickleStepId: step.pickleStepId, hookId: step.hookId });
      }
    }
    if (envelope.testCaseStarted) {
      this.onTestCaseStarted(envelope.testCaseStarted);
    }
    if (envelope.testStepFinished) {
      this.onTestStepFinished(envelope.testStepFinished);
    }
    if (envelope.attachment) {
      this.onAttachment(envelope.attachment);
    }
    if (envelope.testCaseFinished) {
      this.onTestCaseFinished(envelope.testCaseFinished);
    }
  }

  private onTestCaseStarted({ id, testCaseId, attempt, timestamp }: any) {
    const pickle = this.pickles.get(this.testCasePickles.get(testCaseId) ?? '');
    if (!pickle) {
      return;
    }
    const ref: CaseRef = { uri: pickle.uri, line: pickle.line, name: pickle.name };
    this.active.set(id, { ref, attempt: attempt ?? 0, startedAt: toMs(timestamp), steps: [] });
    this.onEvent({ type: 'started', case: ref, attempt: attempt ?? 0 });
  }

  private onTestStepFinished({ testCaseStartedId, testStepId, testStepResult }: any) {
    const tc = this.active.get(testCaseStartedId);
    if (!tc || !testStepResult) {
      return;
    }
    const step = this.stepRef(testStepId);
    const status: string = testStepResult.status;
    const message = testStepResult.message?.trim() || testStepResult.exception?.message?.trim() || undefined;
    tc.steps.push({ status, message, step });
    // hooks are reported only when they did not pass, to keep the output readable
    if (step && (step.kind === 'step' || status !== 'PASSED')) {
      this.onEvent({ type: 'step', case: tc.ref, step, status, durationMs: toMs(testStepResult.duration), message });
    }
  }

  private onAttachment(a: any) {
    const tc = this.active.get(a.testCaseStartedId ?? '');
    if (!tc) {
      return;
    }
    this.onEvent({
      type: 'attachment',
      case: tc.ref,
      attachment: {
        mediaType: a.mediaType ?? 'application/octet-stream',
        body: a.body ?? '',
        encoding: a.contentEncoding === 'BASE64' ? 'BASE64' : 'IDENTITY',
        fileName: a.fileName,
        url: a.url,
      },
    });
  }

  private onTestCaseFinished({ testCaseStartedId, willBeRetried, timestamp }: any) {
    const tc = this.active.get(testCaseStartedId);
    if (!tc) {
      return;
    }
    this.active.delete(testCaseStartedId);
    const finishedAt = toMs(timestamp);
    const durationMs = tc.startedAt !== undefined && finishedAt !== undefined ? Math.max(0, finishedAt - tc.startedAt) : undefined;
    const base = { type: 'finished' as const, case: tc.ref, attempt: tc.attempt, willBeRetried: !!willBeRetried, durationMs };

    const worst = worstStepStatus(tc.steps.map(s => s.status));
    if (worst === 'PASSED') {
      this.onEvent({ ...base, status: 'passed' });
    } else if (worst === 'SKIPPED' || worst === 'PENDING') {
      this.onEvent({ ...base, status: 'skipped' });
    } else {
      const failed = tc.steps.find(s => s.status === worst);
      const message = failed?.message || defaultFailureMessage(worst, failed?.step);
      this.onEvent({ ...base, status: 'failed', message, failedStep: failed?.step });
    }
  }

  private stepRef(testStepId: string | undefined): StepRef | undefined {
    const ts = this.testSteps.get(testStepId ?? '');
    if (!ts) {
      return undefined;
    }
    if (ts.hookId) {
      return { kind: 'hook', ...this.hooks.get(ts.hookId) };
    }
    const ps = this.pickleSteps.get(ts.pickleStepId ?? '');
    if (!ps) {
      return undefined;
    }
    const ast = this.astNodes.get(ps.astNodeId ?? '');
    return { kind: 'step', keyword: ast?.keyword?.trim() ?? '', text: ps.text, line: ast?.line };
  }

  private indexPickle(pickle: any) {
    const { id, astNodeIds, uri, name, steps } = pickle;
    // For outline rows the last astNodeId is the row; for plain scenarios it's the scenario node
    for (let i = (astNodeIds?.length ?? 0) - 1; i >= 0; i--) {
      const node = this.astNodes.get(astNodeIds[i]);
      if (node !== undefined) {
        this.pickles.set(id, { uri: uri ?? '', line: node.line, name: name ?? '' });
        break;
      }
    }
    for (const step of steps ?? []) {
      // the first astNodeId is the step itself; the second (outlines) is the example row
      this.pickleSteps.set(step.id, { text: step.text ?? '', astNodeId: step.astNodeIds?.[0] });
    }
  }

  private indexSteps(steps: any[] | undefined) {
    for (const step of steps ?? []) {
      this.astNodes.set(step.id, { line: step.location.line, keyword: step.keyword });
    }
  }

  private indexChildren(children: any[]): void {
    for (const child of children ?? []) {
      if (child.background) {
        this.indexSteps(child.background.steps);
      }
      if (child.scenario) {
        this.astNodes.set(child.scenario.id, { line: child.scenario.location.line });
        this.indexSteps(child.scenario.steps);
        for (const ex of child.scenario.examples ?? []) {
          for (const row of ex.tableBody ?? []) {
            this.astNodes.set(row.id, { line: row.location.line });
          }
        }
      }
      if (child.rule) {
        this.indexChildren(child.rule.children ?? []);
      }
    }
  }
}

function defaultFailureMessage(status: string, step: StepRef | undefined): string {
  const what = step?.kind === 'step' ? `${step.keyword} ${step.text}`.trim() : step?.kind === 'hook' ? `hook ${step.name ?? ''}`.trim() : '';
  switch (status) {
    case 'UNDEFINED':
      return what ? `Undefined step: ${what}` : 'Scenario failed: UNDEFINED';
    case 'AMBIGUOUS':
      return what ? `Ambiguous step: ${what}` : 'Scenario failed: AMBIGUOUS';
    default:
      return `Scenario failed: ${status}`;
  }
}
