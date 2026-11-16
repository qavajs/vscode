/**
 * QavajsLanguageServer overrides a private method of the pinned @cucumber/language-server and
 * reads its private fields. These tests fail loudly when an upgrade changes those internals.
 */
import { PassThrough } from 'node:stream';
import { ExpressionFactory, ParameterTypeRegistry } from '@cucumber/cucumber-expressions';
import { CucumberLanguageServer } from '@cucumber/language-server';
import { getGherkinDiagnostics } from '@cucumber/language-service';
import { describe, expect, it, vi } from 'vitest';
import { TextDocuments } from 'vscode-languageserver';
import { createConnection } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import QavajsLanguageServer from '../QavajsLanguageServer';

const feature = `Feature: f
  Scenario: s
    Given I open the app
    When nobody defined this step
`;

function createServer() {
  const connection = createConnection(new PassThrough(), new PassThrough());
  const parserAdapter = { init: async () => undefined } as any;
  const server = new QavajsLanguageServer(connection, new TextDocuments(TextDocument), parserAdapter, () => ({}) as any, () => undefined);
  return { connection, server };
}

describe('@cucumber/language-server internals used by QavajsLanguageServer', () => {
  it('still has a sendDiagnostics method that the base class calls for feature changes', () => {
    expect(typeof (CucumberLanguageServer.prototype as any).sendDiagnostics).toBe('function');
    // the override only takes effect if the base dispatches through `this`
    expect(CucumberLanguageServer.toString()).toContain('this.sendDiagnostics(');
    expect(Object.getPrototypeOf(QavajsLanguageServer.prototype)).toBe(CucumberLanguageServer.prototype);
  });

  it('still keeps `connection` and `expressionBuilderResult` as instance fields', () => {
    const { connection, server } = createServer();
    expect((server as any).connection).toBe(connection);
    expect('expressionBuilderResult' in server).toBe(true);
    expect(CucumberLanguageServer.toString()).toMatch(/this\.expressionBuilderResult\s*=\s*this\.expressionBuilder\.build\(/);
  });

  it('still reports undefined steps with the code the override filters out', () => {
    const codes = getGherkinDiagnostics(feature, []).map(d => d.code);
    expect(codes).toContain('cucumber.undefined-step');
  });
});

describe('QavajsLanguageServer.sendDiagnostics', () => {
  it('sends gherkin diagnostics without undefined-step warnings', async () => {
    const { connection, server } = createServer();
    const send = vi.spyOn(connection, 'sendDiagnostics').mockResolvedValue(undefined);
    const expression = new ExpressionFactory(new ParameterTypeRegistry()).createExpression('I open the app');
    (server as any).expressionBuilderResult = { expressionLinks: [{ expression }] };

    const broken = `${feature}  Scenario without colon\n`;
    await server.sendDiagnostics(TextDocument.create('file:///f.feature', 'cucumber', 1, broken));

    expect(send).toHaveBeenCalledTimes(1);
    const { uri, diagnostics } = send.mock.calls[0][0];
    expect(uri).toBe('file:///f.feature');
    expect(diagnostics.map(d => d.code)).not.toContain('cucumber.undefined-step');
    // syntax errors are still reported
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
