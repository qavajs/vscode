# qavajs VSCode extension

This is an extension based on Cucumber official plugin and enables support of qavajs framework features.

## Features

- VSCode Test Explorer

## Extension Settings

This extension contributes the following settings:

* `cucumber.features`: gherkin files paths (array)
* `cucumber.glue`: step definition file paths (array)
* `qavajs.launchCommand`: qavajs launch command (default: `npx qavajs run`) (string)

```json
{  
    "files.associations": {
        "*.feature": "cucumber"
    },
    "cucumber.features": [
        "features/**/*.feature"
    ],
    "cucumber.glue": [
        "node_modules/@qavajs/**/src/*.ts",
        "step_definition/*.ts"
    ],
    "qavajs.launchCommand": "npx qavajs run --config config.ts",
}
```

## How To Use

### Test Explorer
![](resources/test_explorer.png)

## Known Issues and Limitation

* typescript projects require installed `ts-node`
* @qavajs/core > 2
