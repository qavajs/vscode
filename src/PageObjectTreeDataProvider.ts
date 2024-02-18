import * as vscode from 'vscode';
import * as path from 'path';
import { importFile } from './importFile';

export class PageObjectTreeDataProvider implements vscode.TreeDataProvider<PageObjectItem> {
  constructor(private poPath: string) { }

  private _onDidChangeTreeData: vscode.EventEmitter<PageObjectItem | undefined | null | void> = new vscode.EventEmitter<PageObjectItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<PageObjectItem | undefined | null | void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PageObjectItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PageObjectItem): Thenable<PageObjectItem[]> {
    if (this.poPath && vscode.workspace.workspaceFolders) {
      const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const absolutePoPath = path.join(cwd, this.poPath);
      return importFile(absolutePoPath).then(po => {
        if (po.default) po = po.default;
        const data = typeof po === 'function' ? new po() : po;

        if (element) {
          const component = element.parent[element.label];
          return this.getComponentProperties(component).map(
            ([poKey, poValue]: [string, any]) => new PageObjectItem({
              label: poKey, 
              locator: poValue.selector,
              parent: component,
              isComponent: this.isComponent(poValue),
              path: `${element.path} > ${this.normalizePath(poKey)}`,
              isColleciton: poValue.isCollection
          })
          )
        } else {
          return this.getComponentProperties(data).map(
            ([poKey, poValue]: [string, any]) => new PageObjectItem({
              label: poKey, 
              locator: poValue.selector,
              parent: data, 
              isComponent: this.isComponent(poValue),
              path: this.normalizePath(poKey),
              isColleciton: poValue.isCollection
            })
          )
        }
      });
    }
    return Promise.resolve([]);
  }

  getComponentProperties(obj: Object) {
    return Object.entries(obj).filter(([prop]) => ![
      'isCollection', 
      'ignoreHierarchy',
      'selector'
    ].includes(prop))
  }

  isComponent(obj: Object) {
    return this.getComponentProperties(obj).length > 0
  }

  normalizePath(label: string) {
    return label.replace(/([A-Z])/g, ' $1').trim().replace(/\s+/g, ' ')
  }
}

class PageObjectItem extends vscode.TreeItem {
  public readonly label: string;
  private locator: string;
  public parent: any;
  public isComponent: boolean;
  public path: string;
  public isColleciton: boolean;

  constructor({
    label, 
    locator, 
    parent, 
    isComponent,
    path,
    isColleciton
  }: {
    label: string, 
    locator: string, 
    parent: any, 
    isComponent: boolean,
    path: string,
    isColleciton: boolean
  }) {
    const collapsibleState = isComponent
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    super(label, collapsibleState);
    this.label = label;
    this.locator = locator;
    this.parent = parent;
    this.isComponent = isComponent;
    this.description = this.locator;
    this.path = path;
    this.tooltip = this.path;
    this.isColleciton = isColleciton;

    this.iconPath = this.isComponent
      ? new vscode.ThemeIcon('symbol-class')
      : new vscode.ThemeIcon('symbol-interface');  
  }

}
