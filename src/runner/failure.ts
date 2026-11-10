/**
 * Pure helpers that extract structure from assertion error messages, so the Test Results
 * view can show an expected/actual diff and clickable stack frames.
 */

export interface ExpectedActual {
  expected: string;
  actual: string;
}

const EQUALITY_VERB = '(?:(?:deeply |strictly |deep |loosely )*(?:equal|equals|eql)|be equal to|be deeply equal to|be strictly equal to)';
// "to be X" only counts as equality when X is a plain value, not "to be above 3"
const LITERAL = String.raw`(?:'.*'|".*"|\x60.*\x60|-?\d[\d.e+-]*|true|false|null|undefined|NaN|\[.*\]|\{.*\})`;

const PATTERNS: { re: RegExp; actual: number; expected: number }[] = [
  // chai / qavajs: expected 'a' to equal 'b'
  { re: new RegExp(String.raw`expected\s+(.+?)\s+to\s+${EQUALITY_VERB}\s+(.+?)\s*$`, 'im'), actual: 1, expected: 2 },
  { re: new RegExp(String.raw`expected\s+(.+?)\s+to\s+be\s+(${LITERAL})\s*$`, 'im'), actual: 1, expected: 2 },
  // jest / playwright expect: Expected: x \n Received: y
  { re: /^\s*Expected(?: \w+)?:\s*(.+)$[\s\S]*?^\s*Received(?: \w+)?:\s*(.+)$/im, actual: 2, expected: 1 },
  // node:assert strictEqual: 'a' !== 'b'
  { re: /^\s*(.+?) !== (.+?)\s*$/m, actual: 1, expected: 2 },
];

/** Returns expected/actual values for equality assertions; undefined for anything else. */
export function parseExpectedActual(message: string): ExpectedActual | undefined {
  const head = message.split(/\n\s+at /)[0];
  for (const { re, actual, expected } of PATTERNS) {
    const m = re.exec(head);
    if (!m) {
      continue;
    }
    // negated assertions have no meaningful diff
    if (/\bnot\s+to\b|\bto\s+not\b/i.test(m[0])) {
      return undefined;
    }
    return { actual: m[actual].trim(), expected: m[expected].trim() };
  }
  return undefined;
}

export interface StackFrame {
  label: string;
  /** Absolute file path or file:// URL as printed in the stack. */
  file: string;
  line: number;
  column: number;
}

const FRAME = /^\s*at (?:(.*?) \()?((?:file:\/\/)?(?:[a-zA-Z]:)?[^():]+):(\d+):(\d+)\)?\s*$/;

/** Parses V8 `at fn (file:line:col)` frames, skipping node internals and node_modules. */
export function parseStackFrames(message: string, includeNodeModules = false): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const raw of message.split('\n')) {
    const m = FRAME.exec(raw);
    if (!m) {
      continue;
    }
    const file = m[2];
    if (file.startsWith('node:') || (!file.startsWith('/') && !file.startsWith('file://') && !/^[a-zA-Z]:/.test(file))) {
      continue;
    }
    if (!includeNodeModules && /[\\/]node_modules[\\/]/.test(file)) {
      continue;
    }
    frames.push({ label: m[1] || '<anonymous>', file, line: Number(m[3]), column: Number(m[4]) });
  }
  return frames;
}
