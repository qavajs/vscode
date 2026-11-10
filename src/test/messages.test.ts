import { describe, expect, it } from 'vitest';
import { MessageStreamProcessor, type ScenarioEvent, worstStepStatus } from '../runner/messages';

const URI = 'features/login.feature';

const gherkinDocument = {
  gherkinDocument: {
    uri: URI,
    feature: {
      children: [
        { background: { steps: [{ id: 'b1', keyword: 'Given ', location: { line: 2 } }] } },
        { scenario: { id: 's1', location: { line: 3 }, steps: [{ id: 'st1', keyword: 'When ', location: { line: 4 } }], examples: [] } },
        {
          scenario: {
            id: 'o1', location: { line: 6 }, steps: [{ id: 'st2', keyword: 'Then ', location: { line: 7 } }], examples: [
              { tableBody: [{ id: 'r1', location: { line: 10 } }, { id: 'r2', location: { line: 11 } }] },
            ],
          },
        },
        { rule: { children: [{ scenario: { id: 's2', location: { line: 14 }, steps: [], examples: [] } }] } },
      ],
    },
  },
};

const ts = (ms: number) => ({ seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1e6 });

interface CaseOptions {
  steps?: { status: string; message?: string; astNodeIds?: string[]; hook?: boolean }[];
  finished?: object;
  attempt?: number;
  start?: number;
  end?: number;
  between?: object[];
}

function caseEnvelopes(n: number, astNodeIds: string[], { steps = [], finished = {}, attempt = 0, start = 0, end = 0, between = [] }: CaseOptions) {
  const pickleSteps = steps.filter(s => !s.hook).map((s, i) => ({ id: `ps${n}-${i}`, text: `step ${i}`, astNodeIds: s.astNodeIds ?? [] }));
  let p = 0;
  const testSteps = steps.map((s, i) => (s.hook ? { id: `ts${n}-${i}`, hookId: 'h1' } : { id: `ts${n}-${i}`, pickleStepId: pickleSteps[p++].id }));
  return [
    { pickle: { id: `p${n}`, uri: URI, name: `scenario ${n}`, astNodeIds, steps: pickleSteps } },
    { testCase: { id: `tc${n}-${attempt}`, pickleId: `p${n}`, testSteps } },
    { testCaseStarted: { id: `tcs${n}-${attempt}`, testCaseId: `tc${n}-${attempt}`, attempt, timestamp: ts(start) } },
    ...between.map(e => ({ ...e, attachment: { ...(e as any).attachment, testCaseStartedId: `tcs${n}-${attempt}` } })),
    ...steps.map((s, i) => ({
      testStepFinished: {
        testCaseStartedId: `tcs${n}-${attempt}`,
        testStepId: `ts${n}-${i}`,
        testStepResult: { status: s.status, message: s.message, duration: ts(5) },
      },
    })),
    { testCaseFinished: { testCaseStartedId: `tcs${n}-${attempt}`, timestamp: ts(end), ...finished } },
  ];
}

function runStream(envelopes: object[], chunkSize = 7) {
  const events: ScenarioEvent[] = [];
  const text: string[] = [];
  const processor = new MessageStreamProcessor(e => events.push(e), t => text.push(t));
  const stream = envelopes.map(e => JSON.stringify(e)).join('\n');
  // feed in small chunks to exercise line buffering; no trailing newline
  for (let i = 0; i < stream.length; i += chunkSize) {
    processor.write(stream.slice(i, i + chunkSize));
  }
  processor.end();
  return { events, text };
}

const summary = (events: ScenarioEvent[]) =>
  events
    .filter(e => e.type === 'started' || e.type === 'finished')
    .map(e => (e.type === 'started' ? ['started', e.case.line] : ['finished', e.case.line, e.status, e.message]));

describe('worstStepStatus', () => {
  it('prioritises failures over passes', () => {
    expect(worstStepStatus(['PASSED', 'FAILED', 'SKIPPED'])).toBe('FAILED');
    expect(worstStepStatus(['PASSED', 'UNDEFINED'])).toBe('UNDEFINED');
    expect(worstStepStatus(['PASSED'])).toBe('PASSED');
    expect(worstStepStatus([])).toBe('UNKNOWN');
  });
});

describe('MessageStreamProcessor', () => {
  it('maps plain scenarios, outline rows and rule scenarios to their uri and lines', () => {
    const { events } = runStream([
      gherkinDocument,
      ...caseEnvelopes(1, ['s1'], { steps: [{ status: 'PASSED' }] }),
      ...caseEnvelopes(2, ['o1', 'r1'], { steps: [{ status: 'PASSED' }, { status: 'FAILED', message: ' boom \n' }] }),
      ...caseEnvelopes(3, ['o1', 'r2'], { steps: [{ status: 'SKIPPED' }] }),
      ...caseEnvelopes(4, ['s2'], { steps: [{ status: 'UNDEFINED' }] }),
    ]);
    expect(summary(events)).toEqual([
      ['started', 3],
      ['finished', 3, 'passed', undefined],
      ['started', 10],
      ['finished', 10, 'failed', 'boom'],
      ['started', 11],
      ['finished', 11, 'skipped', undefined],
      ['started', 14],
      ['finished', 14, 'failed', 'Undefined step: step 0'],
    ]);
    expect(events[0]).toMatchObject({ type: 'started', case: { uri: URI, line: 3, name: 'scenario 1' } });
  });

  it('reports step results with keyword, text and gherkin line, and the failing step', () => {
    const { events } = runStream([
      gherkinDocument,
      ...caseEnvelopes(1, ['s1'], {
        steps: [
          { status: 'PASSED', astNodeIds: ['b1'] },
          { status: 'FAILED', message: 'expected 1 to equal 2', astNodeIds: ['st1'] },
        ],
      }),
    ]);
    const steps = events.filter(e => e.type === 'step');
    expect(steps).toEqual([
      expect.objectContaining({ step: { kind: 'step', keyword: 'Given', text: 'step 0', line: 2 }, status: 'PASSED', durationMs: 5 }),
      expect.objectContaining({ step: { kind: 'step', keyword: 'When', text: 'step 1', line: 4 }, status: 'FAILED' }),
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'finished', status: 'failed', failedStep: { line: 4 } });
  });

  it('uses the example row step (first astNodeId) for outline steps', () => {
    const { events } = runStream([
      gherkinDocument,
      ...caseEnvelopes(1, ['o1', 'r1'], { steps: [{ status: 'FAILED', astNodeIds: ['st2', 'r1'] }] }),
    ]);
    expect(events.at(-1)).toMatchObject({ failedStep: { line: 7 } });
  });

  it('reports failing hooks with their source but hides passing hooks', () => {
    const { events } = runStream([
      gherkinDocument,
      { hook: { id: 'h1', name: 'screenshot', sourceReference: { uri: 'step_definition/hooks.ts', location: { line: 12 } } } },
      ...caseEnvelopes(1, ['s1'], { steps: [{ status: 'PASSED', hook: true }, { status: 'PASSED', astNodeIds: ['st1'] }, { status: 'FAILED', hook: true, message: 'hook broke' }] }),
    ]);
    expect(events.filter(e => e.type === 'step').map(e => e.type === 'step' && e.step.kind)).toEqual(['step', 'hook']);
    expect(events.at(-1)).toMatchObject({
      status: 'failed',
      message: 'hook broke',
      failedStep: { kind: 'hook', name: 'screenshot', uri: 'step_definition/hooks.ts', line: 12 },
    });
  });

  it('computes scenario duration from timestamps', () => {
    const { events } = runStream([gherkinDocument, ...caseEnvelopes(1, ['s1'], { steps: [{ status: 'PASSED' }], start: 1500, end: 2750 })]);
    expect(events.at(-1)).toMatchObject({ type: 'finished', durationMs: 1250 });
  });

  it('flags attempts that will be retried', () => {
    const { events } = runStream([
      gherkinDocument,
      ...caseEnvelopes(1, ['s1'], { steps: [{ status: 'FAILED' }], finished: { willBeRetried: true } }),
      ...caseEnvelopes(1, ['s1'], { steps: [{ status: 'PASSED' }], attempt: 1 }),
    ]);
    expect(events.filter(e => e.type === 'finished').map(e => e.type === 'finished' && [e.status, e.attempt, e.willBeRetried])).toEqual([
      ['failed', 0, true],
      ['passed', 1, false],
    ]);
    expect(events.filter(e => e.type === 'started').map(e => e.type === 'started' && e.attempt)).toEqual([0, 1]);
  });

  it('forwards attachments of the running scenario', () => {
    const { events } = runStream([
      gherkinDocument,
      ...caseEnvelopes(1, ['s1'], {
        steps: [{ status: 'PASSED' }],
        between: [{ attachment: { body: 'aGk=', contentEncoding: 'BASE64', mediaType: 'image/png', fileName: 'shot.png' } }],
      }),
    ]);
    expect(events.find(e => e.type === 'attachment')).toMatchObject({
      case: { line: 3 },
      attachment: { body: 'aGk=', encoding: 'BASE64', mediaType: 'image/png', fileName: 'shot.png' },
    });
  });

  it('tracks the single running scenario for output attribution', () => {
    const processor = new MessageStreamProcessor(() => undefined);
    const [pickle, testCase, started, finished] = caseEnvelopes(1, ['s1'], {}).filter(e => !('testStepFinished' in e));
    processor.processLine(JSON.stringify(gherkinDocument));
    processor.processLine(JSON.stringify(pickle));
    processor.processLine(JSON.stringify(testCase));
    expect(processor.currentCase()).toBeUndefined();
    processor.processLine(JSON.stringify(started));
    expect(processor.currentCase()).toMatchObject({ line: 3 });
    processor.processLine(JSON.stringify(finished));
    expect(processor.currentCase()).toBeUndefined();
  });

  it('forwards non-envelope stdout lines (including logged JSON) as text', () => {
    const text: string[] = [];
    const processor = new MessageStreamProcessor(() => undefined, t => text.push(t));
    processor.write('hello from test\r\n{"meta":{}}\n{"user":"admin"}\n[1,2]\npartial');
    processor.end();
    expect(text).toEqual(['hello from test', '{"user":"admin"}', '[1,2]', 'partial']);
  });
});
