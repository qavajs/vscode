# Change Log

All notable changes to the "qavajs" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
