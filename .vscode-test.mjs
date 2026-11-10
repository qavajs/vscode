import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  label: 'integration',
  files: 'out/integration/**/*.integration.js',
  version: 'stable',
  workspaceFolder: './test-fixtures/project',
  // built-in extensions (incl. the JavaScript debugger) stay enabled
  launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
  mocha: {
    ui: 'bdd',
    timeout: 120_000,
  },
});
