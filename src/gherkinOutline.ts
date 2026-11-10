/**
 * Pure (vscode-free) structure of a parsed feature: folding ranges and symbols.
 */
import type { FeatureChild, GherkinDocument, Step } from '@cucumber/messages';

export interface Fold {
  start: number;
  end: number;
  kind?: 'comment';
}

/** Folding ranges (0-based lines) for feature blocks, examples, doc strings, tables and comment runs. */
export function computeFolds(content: string, doc: GherkinDocument): Fold[] {
  const lines = content.split(/\r?\n/);
  const folds: Fold[] = [];
  const isBlank = (i: number) => {
    const t = lines[i]?.trim() ?? '';
    return t === '' || t.startsWith('#');
  };
  const lastContentLine = (from: number, to: number) => {
    let end = to;
    while (end > from && isBlank(end)) {
      end--;
    }
    return end;
  };
  const add = (start: number, end: number, kind?: 'comment') => {
    if (end > start) {
      folds.push({ start, end, kind });
    }
  };

  const addSteps = (steps: readonly Step[]) => {
    for (const step of steps) {
      if (step.docString) {
        const start = step.docString.location.line - 1;
        const delimiter = step.docString.delimiter;
        let end = start + 1;
        while (end < lines.length && !lines[end].trim().startsWith(delimiter)) {
          end++;
        }
        add(start, Math.min(end, lines.length - 1));
      }
      if (step.dataTable?.rows.length) {
        const rows = step.dataTable.rows;
        add(rows[0].location.line - 1, rows[rows.length - 1].location.line - 1);
      }
    }
  };

  // first line of a child, including the tags above it
  const startOf = (child: FeatureChild) => {
    const node = child.rule ?? child.scenario ?? child.background;
    const tagLines = (child.rule?.tags ?? child.scenario?.tags ?? []).map(t => t.location.line);
    return Math.min(node!.location.line, ...tagLines) - 1;
  };

  const addChildren = (children: readonly FeatureChild[], containerEnd: number) => {
    children.forEach((child, i) => {
      const next = children[i + 1];
      const start = (child.rule ?? child.scenario ?? child.background)!.location.line - 1;
      const end = lastContentLine(start, (next ? startOf(next) : containerEnd + 1) - 1);
      add(start, end);
      if (child.rule) {
        addChildren(child.rule.children, end);
      }
      if (child.background) {
        addSteps(child.background.steps);
      }
      if (child.scenario) {
        addSteps(child.scenario.steps);
        for (const examples of child.scenario.examples) {
          const rows = examples.tableBody;
          const last = rows.length ? rows[rows.length - 1].location.line : (examples.tableHeader?.location.line ?? examples.location.line);
          add(examples.location.line - 1, last - 1);
        }
      }
    });
  };

  if (doc.feature) {
    const start = doc.feature.location.line - 1;
    const end = lastContentLine(start, lines.length - 1);
    add(start, end);
    addChildren(doc.feature.children, end);
  }

  // runs of comment lines
  let runStart = -1;
  for (let i = 0; i <= lines.length; i++) {
    const comment = i < lines.length && /^\s*#/.test(lines[i]) && !/^\s*#\s*language\s*:/.test(lines[i]);
    if (comment && runStart === -1) {
      runStart = i;
    } else if (!comment && runStart !== -1) {
      add(runStart, i - 1, 'comment');
      runStart = -1;
    }
  }
  return folds;
}

export interface FeatureSymbol {
  name: string;
  kind: 'feature' | 'rule' | 'background' | 'scenario';
  keyword: string;
  line: number;
  container?: string;
}

export function featureSymbols(doc: GherkinDocument): FeatureSymbol[] {
  const symbols: FeatureSymbol[] = [];
  if (!doc.feature) {
    return symbols;
  }
  const featureName = doc.feature.name || 'Feature';
  symbols.push({ name: featureName, kind: 'feature', keyword: doc.feature.keyword, line: doc.feature.location.line - 1 });
  const walk = (children: readonly FeatureChild[], container: string) => {
    for (const child of children) {
      if (child.rule) {
        symbols.push({ name: child.rule.name || 'Rule', kind: 'rule', keyword: child.rule.keyword, line: child.rule.location.line - 1, container });
        walk(child.rule.children, child.rule.name || container);
      } else if (child.scenario) {
        symbols.push({ name: child.scenario.name, kind: 'scenario', keyword: child.scenario.keyword, line: child.scenario.location.line - 1, container });
      }
    }
  };
  walk(doc.feature.children, featureName);
  return symbols;
}

/** Characters of `needle` appear in order in `haystack`. */
export function fuzzyMatch(haystack: string, needle: string): boolean {
  let i = 0;
  for (const c of haystack) {
    if (c === needle[i]) {
      i++;
    }
    if (i === needle.length) {
      return true;
    }
  }
  return needle.length === 0;
}
