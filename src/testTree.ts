import * as vscode from 'vscode';
import { type GherkinNode, type NodeKind, parseFeature } from './gherkin';

const textDecoder = new TextDecoder('utf-8');

export type TestData = TestFile | TestNode;

export const testData = new WeakMap<vscode.TestItem, TestData>();

export const getContentFromFilesystem = async (uri: vscode.Uri) => {
  const rawContent = await vscode.workspace.fs.readFile(uri);
  return textDecoder.decode(rawContent);
};

const tagCache = new Map<string, vscode.TestTag>();
const testTag = (name: string) => {
  let tag = tagCache.get(name);
  if (!tag) {
    tag = new vscode.TestTag(name);
    tagCache.set(name, tag);
  }
  return tag;
};

export class TestFile {
  public didResolve = false;

  public async updateFromDisk(controller: vscode.TestController, item: vscode.TestItem) {
    try {
      const content = await getContentFromFilesystem(item.uri!);
      this.updateFromContents(controller, content, item);
    } catch (e) {
      item.error = `Failed to read ${item.uri?.fsPath}: ${(e as Error).message}`;
    }
  }

  public updateFromContents(controller: vscode.TestController, content: string, item: vscode.TestItem) {
    this.didResolve = true;

    const result = parseFeature(content);
    if (!result.ok) {
      // keep previously discovered tests visible while the file is being edited
      item.error = new vscode.MarkdownString().appendText(`Gherkin parse error: ${result.error}`);
      return;
    }
    item.error = undefined;
    item.children.replace(result.feature ? [createItem(controller, item.uri!, result.feature, `${item.uri}`, [])] : []);
  }
}

/** A runnable node: feature, rule, scenario, outline or example row. */
export class TestNode {
  constructor(
    public readonly kind: NodeKind,
    public readonly line: number,
    public readonly fsPath: string
  ) { }

  /** `--paths` value selecting exactly the scenarios under this node. */
  location(item: vscode.TestItem): string {
    switch (this.kind) {
      case 'feature':
        return this.fsPath;
      case 'rule': {
        const lines = leafItems(item).map(leaf => (testData.get(leaf) as TestNode).line);
        return lines.length ? `${this.fsPath}:${lines.join(':')}` : this.fsPath;
      }
      default:
        return `${this.fsPath}:${this.line}`;
    }
  }

  get isLeaf() {
    return this.kind === 'scenario' || this.kind === 'example';
  }
}

function createItem(
  controller: vscode.TestController,
  uri: vscode.Uri,
  node: GherkinNode,
  parentId: string,
  inheritedTags: readonly string[]
): vscode.TestItem {
  const id = node.kind === 'feature' ? `${parentId}/feature` : `${parentId}/${node.line}`;
  const item = controller.createTestItem(id, node.name, uri);
  item.range = new vscode.Range(node.line - 1, 0, node.line - 1, 0);
  // effective tags (inherited from feature / rule / outline) so Test Explorer `@qavajs:tag` filters work
  const tags = [...new Set([...inheritedTags, ...node.tags])];
  item.tags = tags.map(testTag);
  if (node.tags.length) {
    item.description = node.tags.map(t => `@${t}`).join(' ');
  }
  testData.set(item, new TestNode(node.kind, node.line, uri.fsPath));
  item.children.replace(node.children.map(child => createItem(controller, uri, child, id, tags)));
  return item;
}

export function gatherTestItems(collection: vscode.TestItemCollection): vscode.TestItem[] {
  const items: vscode.TestItem[] = [];
  collection.forEach(item => {
    items.push(item);
  });
  return items;
}

/** Leaf (scenario / example row) items at or below `item`. */
export function leafItems(item: vscode.TestItem): vscode.TestItem[] {
  const data = testData.get(item);
  if (data instanceof TestNode && data.isLeaf) {
    return [item];
  }
  return gatherTestItems(item.children).flatMap(leafItems);
}
