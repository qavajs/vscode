/**
 * Pure (vscode-free) parsing of a .feature file into a simple node tree used to
 * build the Test Explorer hierarchy. Lines are 1-based gherkin lines.
 */
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import type { FeatureChild, GherkinDocument } from '@cucumber/messages';

export type NodeKind = 'feature' | 'rule' | 'scenario' | 'outline' | 'example';

export interface GherkinNode {
  kind: NodeKind;
  name: string;
  line: number;
  /** Tags declared directly on this node (without `@`). Example rows carry their Examples block's tags. */
  tags: string[];
  children: GherkinNode[];
}

export type ParseResult =
  | { ok: true; feature: GherkinNode | undefined }
  | { ok: false; error: string };

let idCounter = 0;

/** Parses gherkin into the raw AST; throws on syntax errors. Honours `# language:`. */
export function parseGherkinDocument(content: string): GherkinDocument {
  const parser = new Parser(new AstBuilder(() => String(idCounter++)), new GherkinClassicTokenMatcher());
  return parser.parse(content);
}

const tagNames = (tags: readonly { name: string }[]) => tags.map(t => t.name.replace(/^@/, ''));

export function parseFeature(content: string): ParseResult {
  let doc: GherkinDocument;
  try {
    doc = parseGherkinDocument(content);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!doc.feature) {
    return { ok: true, feature: undefined };
  }
  return {
    ok: true,
    feature: {
      kind: 'feature',
      name: doc.feature.name || 'Feature',
      line: doc.feature.location.line,
      tags: tagNames(doc.feature.tags),
      children: buildChildren(doc.feature.children),
    },
  };
}

/** Replaces every `<header>` placeholder in an outline name with the row value. */
export function interpolateName(name: string, headers: readonly string[], values: readonly string[]): string {
  return headers.reduce((acc, header, i) => acc.split(`<${header}>`).join(values[i] ?? ''), name);
}

function buildChildren(children: readonly FeatureChild[]): GherkinNode[] {
  const nodes: GherkinNode[] = [];
  for (const child of children) {
    if (child.rule) {
      nodes.push({
        kind: 'rule',
        name: child.rule.name || 'Rule',
        line: child.rule.location.line,
        tags: tagNames(child.rule.tags),
        children: buildChildren(child.rule.children),
      });
      continue;
    }
    const { scenario } = child;
    if (!scenario) {
      continue;
    }
    if (scenario.examples.length === 0) {
      nodes.push({ kind: 'scenario', name: scenario.name, line: scenario.location.line, tags: tagNames(scenario.tags), children: [] });
      continue;
    }
    const rows: GherkinNode[] = [];
    for (const examples of scenario.examples) {
      const headers = (examples.tableHeader?.cells ?? []).map(c => c.value);
      for (const row of examples.tableBody) {
        rows.push({
          kind: 'example',
          name: interpolateName(scenario.name, headers, row.cells.map(c => c.value)),
          line: row.location.line,
          tags: tagNames(examples.tags),
          children: [],
        });
      }
    }
    nodes.push({ kind: 'outline', name: scenario.name, line: scenario.location.line, tags: tagNames(scenario.tags), children: rows });
  }
  return nodes;
}
