import { CucumberLanguageServer } from '@cucumber/language-server';
import { getGherkinDiagnostics } from '@cucumber/language-service';
import type { Connection } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * Private members of CucumberLanguageServer (pinned @cucumber/language-server version)
 * that this subclass relies on. Re-check on every upgrade of that package.
 */
interface CucumberLanguageServerInternals {
  connection: Connection;
  expressionBuilderResult?: { expressionLinks: { expression: Parameters<typeof getGherkinDiagnostics>[1][number] }[] };
}

// @ts-expect-error sendDiagnostics is private in the base class; we override it on purpose
export default class QavajsLanguageServer extends CucumberLanguageServer {
  /** Same as upstream, but without `cucumber.undefined-step` (qavajs resolves steps at runtime). */
  async sendDiagnostics(textDocument: TextDocument): Promise<void> {
    const internals = this as unknown as CucumberLanguageServerInternals;
    const expressions = (internals.expressionBuilderResult?.expressionLinks ?? []).map(l => l.expression);
    const diagnostics = getGherkinDiagnostics(textDocument.getText(), expressions)
      .filter(d => d.code !== 'cucumber.undefined-step');
    await internals.connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  }
}
