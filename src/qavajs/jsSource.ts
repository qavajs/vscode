/**
 * Lightweight, dependency-free scanning of JS/TS sources: enough structure to find step definitions
 * and their JSDoc without bundling the TypeScript compiler.
 */

/** 0-based position. */
export interface Pos {
  line: number;
  character: number;
}

/**
 * Replaces comments and string / template / regex literal contents with spaces (newlines are kept),
 * so offsets and line numbers stay valid while braces and keywords inside literals disappear.
 * Quote characters are kept so string boundaries remain visible.
 */
export function maskSource(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      if (out[i] !== '\n' && out[i] !== '\r') {
        out[i] = ' ';
      }
    }
  };
  let i = 0;
  const n = src.length;
  // last significant code char, to tell a regex literal from a division
  let prev = '';
  let prevWord = '';
  const templateDepth: number[] = [];
  let braceDepth = 0;

  const skipString = (quote: string) => {
    const start = i;
    i++;
    while (i < n && src[i] !== quote && src[i] !== '\n') {
      i += src[i] === '\\' ? 2 : 1;
    }
    blank(start + 1, Math.min(i, n));
    i++;
  };

  /** Scans template text from i (just after ` or }) until ` (end) or ${ (expression). */
  const scanTemplateText = () => {
    const start = i;
    while (i < n) {
      if (src[i] === '\\') {
        i += 2;
        continue;
      }
      if (src[i] === '`') {
        blank(start, i);
        i++;
        return;
      }
      if (src[i] === '$' && src[i + 1] === '{') {
        blank(start, i);
        i += 2;
        templateDepth.push(braceDepth);
        braceDepth++;
        return;
      }
      i++;
    }
    blank(start, n);
  };

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      skipString(c);
      prev = c;
      continue;
    }
    if (c === '`') {
      i++;
      scanTemplateText();
      prev = '`';
      continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || ['return', 'typeof', 'case', 'in', 'of', 'yield', 'await'].includes(prevWord))) {
      const start = i;
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '[') {
          inClass = true;
        } else if (src[i] === ']') {
          inClass = false;
        } else if (src[i] === '/' && !inClass) {
          break;
        }
        i++;
      }
      blank(start + 1, i);
      i++;
      while (i < n && /[a-z]/i.test(src[i])) {
        i++;
      }
      prev = '/';
      prevWord = '';
      continue;
    }
    if (c === '{') {
      braceDepth++;
    } else if (c === '}') {
      braceDepth--;
      if (templateDepth.length && templateDepth[templateDepth.length - 1] === braceDepth) {
        templateDepth.pop();
        i++;
        scanTemplateText();
        prev = '`';
        continue;
      }
    }
    if (!/\s/.test(c)) {
      if (/[\w$]/.test(c)) {
        let j = i;
        while (j < n && /[\w$]/.test(src[j])) {
          j++;
        }
        prevWord = src.slice(i, j);
        prev = 'a';
        i = j;
        continue;
      }
      prev = c;
      prevWord = '';
    }
    i++;
  }
  return out.join('');
}

export function lineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

export function offsetToPos(starts: readonly number[], offset: number): Pos {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { line: lo, character: offset - starts[lo] };
}

/** Leading `/** *\/` or `//` comments directly above `offset`. */
export function leadingComment(src: string, offset: number): string | undefined {
  let end = offset;
  while (end > 0 && /\s/.test(src[end - 1])) {
    end--;
  }
  if (src.slice(end - 2, end) === '*/') {
    const start = src.lastIndexOf('/*', end - 2);
    if (start !== -1) {
      return src.slice(start, end);
    }
    return undefined;
  }
  const lines: string[] = [];
  let lineEnd = end;
  while (lineEnd > 0) {
    const lineStart = src.lastIndexOf('\n', lineEnd - 1) + 1;
    const text = src.slice(lineStart, lineEnd).trim();
    if (!text.startsWith('//')) {
      break;
    }
    lines.unshift(text);
    lineEnd = lineStart - 1;
    while (lineEnd > 0 && src[lineEnd - 1] === '\r') {
      lineEnd--;
    }
  }
  return lines.length ? lines.join('\n') : undefined;
}

/** Converts a comment block to plain text (strips `/**`, `*` prefixes and `//`). */
export function commentText(comment: string): string {
  return comment
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(l => l.replace(/^\s*\*\s?/, '').replace(/^\s*\/\/\s?/, ''))
    .join('\n')
    .trim();
}

/** Reads the string literal starting at `offset` (a quote char); undefined for templates with `${}`. */
export function readStringLiteral(src: string, offset: number): { value: string; end: number } | undefined {
  const quote = src[offset];
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    return undefined;
  }
  let value = '';
  let i = offset + 1;
  while (i < src.length && src[i] !== quote) {
    if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
      return undefined;
    }
    if (src[i] === '\\') {
      const e = src[i + 1];
      value += e === 'n' ? '\n' : e === 't' ? '\t' : e;
      i += 2;
      continue;
    }
    if (src[i] === '\n' && quote !== '`') {
      return undefined;
    }
    value += src[i];
    i++;
  }
  return i < src.length ? { value, end: i + 1 } : undefined;
}

/** Reads the regex literal starting at `offset` (a `/`). */
export function readRegexLiteral(src: string, offset: number): { source: string; flags: string; end: number } | undefined {
  if (src[offset] !== '/') {
    return undefined;
  }
  let i = offset + 1;
  let inClass = false;
  while (i < src.length && src[i] !== '\n') {
    if (src[i] === '\\') {
      i += 2;
      continue;
    }
    if (src[i] === '[') {
      inClass = true;
    } else if (src[i] === ']') {
      inClass = false;
    } else if (src[i] === '/' && !inClass) {
      const source = src.slice(offset + 1, i);
      let j = i + 1;
      while (j < src.length && /[a-z]/i.test(src[j])) {
        j++;
      }
      return { source, flags: src.slice(i + 1, j), end: j };
    }
    i++;
  }
  return undefined;
}

export interface StepDefinitionInfo {
  keyword: string;
  /** Cucumber expression, or the regex source when `regex` is true. */
  expression: string;
  regex?: { flags: string };
  pos: Pos;
  doc?: string;
}

export interface ParameterTypeInfo {
  name: string;
  regexp?: { source: string; flags: string };
}

const STEP_CALL_RE = /(?<![\w$.])(Given|When|Then|defineStep|Step)\s*\(\s*/g;

export function parseStepDefinitions(src: string, masked = maskSource(src)): StepDefinitionInfo[] {
  const starts = lineStarts(src);
  const defs: StepDefinitionInfo[] = [];
  STEP_CALL_RE.lastIndex = 0;
  for (let m = STEP_CALL_RE.exec(masked); m; m = STEP_CALL_RE.exec(masked)) {
    const argStart = m.index + m[0].length;
    const comment = leadingComment(src, statementStart(masked, m.index));
    const doc = comment?.startsWith('/**') ? commentText(comment) : undefined;
    const pos = offsetToPos(starts, m.index);
    const str = readStringLiteral(src, argStart);
    if (str) {
      defs.push({ keyword: m[1], expression: str.value, pos, doc });
      continue;
    }
    const re = readRegexLiteral(src, argStart);
    if (re) {
      defs.push({ keyword: m[1], expression: re.source, regex: { flags: re.flags }, pos, doc });
    }
  }
  return defs;
}

/** Start of the expression statement containing `offset` (skips `export`, `cucumber.` prefixes). */
function statementStart(masked: string, offset: number): number {
  let i = offset;
  while (i > 0 && /[\w$.\s]/.test(masked[i - 1]) && masked[i - 1] !== '\n') {
    i--;
  }
  return i;
}

/** Literal `defineParameterType({ name: 'x', regexp: /.../ })` declarations. */
export function parseParameterTypes(src: string, masked = maskSource(src)): ParameterTypeInfo[] {
  const types: ParameterTypeInfo[] = [];
  const re = /\bdefineParameterType\s*\(\s*\{/g;
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    // find the end of the object literal using the masked text
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < masked.length && depth > 0) {
      if (masked[i] === '{') {
        depth++;
      } else if (masked[i] === '}') {
        depth--;
      }
      i++;
    }
    const body = src.slice(m.index + m[0].length, i - 1);
    const name = /\bname\s*:\s*(['"`])([^'"`]+)\1/.exec(body)?.[2];
    if (!name) {
      continue;
    }
    const regexpAt = /\bregexp\s*:\s*/.exec(body);
    const literal = regexpAt ? readRegexLiteral(body, regexpAt.index + regexpAt[0].length) : undefined;
    types.push({ name, regexp: literal ? { source: literal.source, flags: literal.flags } : undefined });
  }
  return types;
}
