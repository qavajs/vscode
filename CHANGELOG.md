# Change Log

All notable changes to the "qavajs" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]
- Selected tests of a workspace folder now run in a single qavajs process (previously one process per feature/scenario)
- Debug profiles: debug any test with breakpoints in step definitions and support code
- Failure messages point at the failing step (or the failing hook's source), with an expected/actual diff for equality assertions and clickable stack frames
- Durations for scenarios and containers; step-by-step output, `console.log` and qavajs logs linked to their scenario
- Screenshots and other attachments are saved and linked from the failure message
- Retries are reported; scenarios passing after a retry are flagged as flaky in the output
- Gherkin tags are exposed as Test Explorer tags (`@qavajs:tag` filter); the test controller id is now `qavajs`
- Launch profiles support `env`, `cwd` and `tags`, and `${workspaceFolder}` / `${env:NAME}` substitution
- Step definition JSDoc (description, params, examples) on hover in feature files
- Folding ranges for feature files and workspace-wide scenario search
- Multi-root: `cucumber.features` and launch profiles are read per workspace folder; adding/removing folders refreshes the tree
- Workspace Trust: running tests requires a trusted workspace; launch settings from untrusted workspaces are ignored
- The extension activates when the workspace contains `.feature` files, so the Test Explorer is populated without opening one
- Fixed Scenario Outline status: example rows now report individually, and the outline is failed if any row fails (previously the last finished row won)
- Fixed continuous (watch) runs ignoring the selected launch profile's command; every profile now supports continuous run
- Tests are selected by location (`--paths file:line`) instead of a `--name` regex, which fixes duplicate scenario names and names containing quotes, `$` or backticks
- Fixed runs hanging when the command fails to start; scenarios with no reported result are marked errored, and the process output is shown
- Cancelling a run now kills the whole process tree (npx → node → browsers)
- Multi-root workspaces: tests run from the workspace folder that contains the feature file
- Gherkin parse errors are shown on the file in the Test Explorer
- Test tree and watchers are rebuilt when `cucumber.features` changes; document re-parsing is debounced
- Excluding a scenario no longer runs it as part of its parent feature
- Non-message stdout from tests is shown in the test output
- Gherkin syntax highlighting grammar is now contributed
- **Requires VS Code 1.145+**
- Upgraded to `@cucumber/language-server` / `@cucumber/language-service` 2.0, `@cucumber/gherkin` 42, `@cucumber/messages` 34, `vscode-languageclient` 11, `vscode-languageserver` 11
- Upgraded tooling: `@vscode/vsce` 4, `copy-webpack-plugin` 14, webpack 5.112 (TypeScript stays on 6.0: TypeScript 7 has no compiler API for ts-loader yet)
- Removed unused runtime dependencies (`ts-node`, `@cucumber/cucumber-expressions`); pinned `@cucumber/language-server`
- Tooling: Biome for linting and Vitest for unit tests (replacing ESLint and mocha); type-check + lint + tests + packaging in CI
- Integration tests in a real VS Code (`@vscode/test-cli`) against a qavajs fixture project, run in CI
- Guard tests for the `@cucumber/language-server` internals that the undefined-step filter relies on
- Runs also stop when the run request is cancelled, not only the test run

## [0.11.0]
- Added `qavajs.launchProfiles` setting to define multiple named run profiles (e.g. Dev, CI) selectable from the Test Explorer dropdown

## [0.10.1]
- Fixed launch lag on Windows by using VS Code's configured terminal shell instead of hardcoded `powershell.exe`

## [0.10.0]

- Added feature-level and suite-level test execution (whole feature runs as a single process instead of one process per scenario)
- Real-time per-scenario status updates using cucumber `--format message` streaming reporter
- Inline error messages for failed scenarios display the actual assertion error and stack trace
- Support for Scenario Outlines: each example row reported individually

## [0.9.0]

- Added native Gherkin document parsing via `@cucumber/gherkin`
- Reworked test execution to use child process spawning with piped output
- Improved test tree structure to reflect Feature / Rule / Scenario hierarchy

## [0.8.0]

- Disable unused features

## [0.7.1]

- Fixed commonjs project imports
  
## [0.7.0]

- Added feature file cucumber icon
- Added capability to navigate to template definitions
  
## [0.6.3]

- Fixed Windows initial test scan
- Disabled page object explorer for non .feature files
- Fixed regexp chars escaping

## [0.6.2]

- Fixed Windows test execution
- Fixed square brackets escaping
- Added launchCommand setting
  
## [0.6.1]

- Addded icon
  
## [0.6.0]

- Addded test explorer support
- Added page object tree view
  
## [0.5.4]

- Addded logic go invalidate import cache for page objects
  
## [0.5.3]

- Updated import code to use project tsconfig
  
## [0.5.2]

- Fixed bug of removing gherkin comments

## [0.5.1]

- Moved configuration to appropriate section

## [0.5.0]

- Added capability to return whole hierarchy of page objects
Breaking Changes:
`pageObjects` config renamed to `pageObject` and type changed from array to string
`memory` config type changed from array to string

## [0.0.4]

- Added capability to run one scenario via context menu

## [0.0.3]

- Added tab stopper to template snippets

## [0.0.2]

- Initial release
