import type * as vscode from 'vscode';

/**
 * Test-only observation of TestRun calls. VS Code has no stable API to read test results,
 * so the integration tests subscribe here (via the extension's exports) to see what the
 * extension reported. Without listeners, runs are returned unwrapped.
 */
export interface RunCall {
  method: string;
  args: unknown[];
}

const listeners = new Set<(run: vscode.TestRun, call: RunCall) => void>();

export function onRunCall(listener: (run: vscode.TestRun, call: RunCall) => void): vscode.Disposable {
  listeners.add(listener);
  return { dispose: () => listeners.delete(listener) };
}

export function instrumentRun(run: vscode.TestRun): vscode.TestRun {
  if (listeners.size === 0) {
    return run;
  }
  return new Proxy(run, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') {
        return value;
      }
      return (...args: unknown[]) => {
        for (const listener of listeners) {
          listener(target, { method: String(prop), args });
        }
        return value.apply(target, args);
      };
    },
  });
}

export interface TestingApi {
  controller: vscode.TestController;
  runProfiles(): readonly vscode.TestRunProfile[];
  onRunCall: typeof onRunCall;
}
