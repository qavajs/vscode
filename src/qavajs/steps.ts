/**
 * Pure step-definition matching (for hover docs) and JSDoc parsing.
 */
import { type Expression, ExpressionFactory, ParameterType, ParameterTypeRegistry } from '@cucumber/cucumber-expressions';
import type { ParameterTypeInfo, StepDefinitionInfo } from './jsSource';

export interface JsDoc {
  description: string;
  params: { type?: string; name: string; description: string }[];
  examples: string[];
  tags: { tag: string; text: string }[];
}

/** Parses JSDoc text (already stripped of comment markers). */
export function parseJsDoc(text: string): JsDoc {
  const doc: JsDoc = { description: '', params: [], examples: [], tags: [] };
  const blocks = text.split(/\n(?=\s*@\w)/);
  const first = blocks[0].trimStart().startsWith('@') ? '' : (blocks.shift() ?? '');
  doc.description = first.trim();
  for (const block of blocks) {
    const m = /^\s*@(\w+)\s*([\s\S]*)$/.exec(block);
    if (!m) {
      continue;
    }
    const [, tag, rest] = m;
    if (tag === 'param' || tag === 'arg' || tag === 'argument') {
      const p = /^(?:\{([^}]*)\}\s*)?(\[?[\w$.]+(?:=[^\]]*)?\]?)\s*(?:-\s*)?([\s\S]*)$/.exec(rest.trim());
      if (p) {
        doc.params.push({ type: p[1], name: p[2], description: p[3].trim() });
      }
    } else if (tag === 'example') {
      doc.examples.push(rest.replace(/\s+$/, ''));
    } else {
      doc.tags.push({ tag, text: rest.trim() });
    }
  }
  return doc;
}

/** Fallback for parameter types defined dynamically (e.g. qavajs `{validation}`, `{value}`). */
const ANY = '.*?';

interface CompiledStep {
  def: StepDefinitionInfo & { file: string };
  matches(text: string): boolean;
}

export class StepMatcher {
  private readonly compiled: CompiledStep[] = [];

  constructor(defs: readonly (StepDefinitionInfo & { file: string })[], parameterTypes: readonly ParameterTypeInfo[] = []) {
    const registry = new ParameterTypeRegistry();
    for (const type of parameterTypes) {
      defineType(registry, type.name, type.regexp ? safeRegExp(type.regexp.source, type.regexp.flags) : undefined);
    }
    const factory = new ExpressionFactory(registry);
    for (const def of defs) {
      if (def.regex) {
        const re = safeRegExp(def.expression, def.regex.flags.replace(/[gy]/g, ''));
        if (re) {
          this.compiled.push({ def, matches: text => re.test(text) });
        }
        continue;
      }
      const expression = createExpression(factory, registry, def.expression);
      if (expression) {
        this.compiled.push({ def, matches: text => expression.match(text) !== null });
      }
    }
  }

  get size() {
    return this.compiled.length;
  }

  match(text: string): (StepDefinitionInfo & { file: string }) | undefined {
    return this.compiled.find(c => {
      try {
        return c.matches(text);
      } catch {
        return false;
      }
    })?.def;
  }
}

function safeRegExp(source: string, flags = ''): RegExp | undefined {
  try {
    return new RegExp(source, flags);
  } catch {
    return undefined;
  }
}

function defineType(registry: ParameterTypeRegistry, name: string, regexp?: RegExp) {
  if (registry.lookupByTypeName(name) || !ParameterType.isValidParameterTypeName(name)) {
    return;
  }
  try {
    registry.defineParameterType(new ParameterType(name, regexp ?? ANY, null, s => s, false, false));
  } catch {
    // conflicting regexps: fall back to a catch-all
    try {
      registry.defineParameterType(new ParameterType(name, ANY, null, s => s, false, false));
    } catch {
      /* already defined */
    }
  }
}

function createExpression(factory: ExpressionFactory, registry: ParameterTypeRegistry, source: string): Expression | undefined {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return factory.createExpression(source);
    } catch (e) {
      const missing = (e as { undefinedParameterTypeName?: string }).undefinedParameterTypeName;
      if (!missing) {
        return undefined;
      }
      defineType(registry, missing);
    }
  }
  return undefined;
}

// ------------------------------------------------------------------ feature line helpers

export interface StepLine {
  keyword: string;
  text: string;
  /** Offset of `text` in the line. */
  textStart: number;
}

/** Splits a feature line into keyword and step text, using dialect step keywords (e.g. `Given `, `* `). */
export function parseStepLine(line: string, keywords: readonly string[]): StepLine | undefined {
  const indent = line.length - line.trimStart().length;
  const rest = line.slice(indent);
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  for (const kw of sorted) {
    if (rest.startsWith(kw)) {
      const text = rest.slice(kw.length);
      const lead = text.length - text.trimStart().length;
      return { keyword: kw.trim(), text: text.trim(), textStart: indent + kw.length + lead };
    }
  }
  return undefined;
}
