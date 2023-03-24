/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ([
/* 0 */,
/* 1 */
/***/ ((module) => {

module.exports = require("vscode");

/***/ }),
/* 2 */
/***/ ((module) => {

module.exports = require("child_process");

/***/ })
/******/ 	]);
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
var exports = __webpack_exports__;

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.deactivate = exports.activate = void 0;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __webpack_require__(1);
const child_process_1 = __webpack_require__(2);
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
function activate(context) {
    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('qavajs.execute', () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        if (vscode.window.activeTextEditor) {
            const { text } = vscode.window.activeTextEditor.document.lineAt(vscode.window.activeTextEditor.selection.active.line);
            if (vscode.workspace.workspaceFolders) {
                let wf = vscode.workspace.workspaceFolders[0].uri.path;
                let f = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const message = `YOUR-EXTENSION: folder: ${wf} - ${f}`;
                // vscode.window.showInformationMessage(message);
                const scenarioName = text.replace(/Scenario:|Scenario Outline:/, '').trim();
                const command = `npm run qavajs -- --name "${scenarioName}" --format summary`;
                vscode.window.showInformationMessage(`Executing: ${command}`);
                (0, child_process_1.exec)(command, { cwd: vscode.workspace.workspaceFolders[0].uri.path }, (error, stdout, stderr) => {
                    if (error) {
                        vscode.window.showInformationMessage(`exec error: ${error}`);
                        return;
                    }
                    const isFailed = stdout.includes('Failures:');
                    vscode.window.showInformationMessage(`${scenarioName} - ${isFailed ? 'Failed' : 'Passed'}`);
                });
            }
            // exec(`echo '${text}'`, (error, stdout, stderr) => {
            // 	if (error) {
            // 		vscode.window.showInformationMessage(`exec error: ${error}`);
            // 		console.error(`exec error: ${error}`);
            // 		return;
            // 	}
            // 	vscode.window.showInformationMessage(stdout);
            // 	console.log(`stdout: ${stdout}`);
            // 	console.error(`stderr: ${stderr}`);
            // });
        }
    });
    context.subscriptions.push(disposable);
}
exports.activate = activate;
// This method is called when your extension is deactivated
function deactivate() { }
exports.deactivate = deactivate;

})();

module.exports = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=extension.js.map