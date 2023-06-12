# qavajs README

This is extension based on Cucumber official plugin and enables support of qavajs framework features.

## Features

- Run single scenario
- Template Autocomplete
- Constants Autocomplete
- Page Object Autocomplete

## Extension Settings

This extension contributes the following settings:

* `cucumber.features`: gherkin files paths (array)
* `cucumber.glue`: step definition file paths (array)
* `qavajs.templates`: templates files paths (array)
* `qavajs.pageObject`: page object root file path (string)
* `qavajs.memory`: memory root file path (string)
* `qavajs.launchCommand`: qavajs launch command (default: `npx qavajs run`) (string)

## Known Issues and Limitation

* typescript projects require installed `ts-node`