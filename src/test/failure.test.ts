import { describe, expect, it } from 'vitest';
import { parseExpectedActual, parseStackFrames } from '../runner/failure';

describe('parseExpectedActual', () => {
  it.each([
    ["AssertionError: expected 'foo' to equal 'bar'", "'bar'", "'foo'"],
    ['expected 3 to deeply equal 4\n    at x (/a/b.ts:1:1)', '4', '3'],
    ["expected 'abc' to be 'abd'", "'abd'", "'abc'"],
    ['Error: expect(received).toBe(expected)\n\nExpected: "Login"\nReceived: "Logout"', '"Login"', '"Logout"'],
    ["Expected values to be strictly equal:\n\n'a' !== 'b'\n", "'b'", "'a'"],
  ])('%s', (message, expected, actual) => {
    expect(parseExpectedActual(message)).toEqual({ expected, actual });
  });

  it.each([
    "expected 'foo' to not equal 'foo'",
    "expected 'foo' not to equal 'foo'",
    'expected 5 to be above 10',
    "expected 'abc' to contain 'd'",
    'TimeoutError: locator.click: Timeout 30000ms exceeded',
  ])('no diff for %s', message => {
    expect(parseExpectedActual(message)).toBeUndefined();
  });
});

describe('parseStackFrames', () => {
  const stack = [
    "AssertionError: expected 'a' to equal 'b'",
    '    at World.<anonymous> (/project/step_definition/custom.ts:12:5)',
    '    at /project/node_modules/@qavajs/core/src/x.js:3:9',
    '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
    '    at file:///project/memory/index.ts:7:11',
    '    at C:\\project\\steps.ts:4:2',
  ].join('\n');

  it('keeps project frames and skips node internals and node_modules', () => {
    expect(parseStackFrames(stack)).toEqual([
      { label: 'World.<anonymous>', file: '/project/step_definition/custom.ts', line: 12, column: 5 },
      { label: '<anonymous>', file: 'file:///project/memory/index.ts', line: 7, column: 11 },
      { label: '<anonymous>', file: 'C:\\project\\steps.ts', line: 4, column: 2 },
    ]);
  });

  it('can include node_modules frames', () => {
    expect(parseStackFrames(stack, true)).toHaveLength(4);
  });
});
