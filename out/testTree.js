"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestCase = exports.TestFile = exports.getContentFromFilesystem = exports.testData = void 0;
exports.parseFeature = parseFeature;
const util_1 = require("util");
const vscode = __importStar(require("vscode"));
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const node_os_1 = require("node:os");
const textDecoder = new util_1.TextDecoder('utf-8');
exports.testData = new WeakMap();
let generationCounter = 0;
const getContentFromFilesystem = async (uri) => {
    try {
        const rawContent = await vscode.workspace.fs.readFile(uri);
        return textDecoder.decode(rawContent);
    }
    catch (e) {
        console.warn(`Error providing tests for ${uri.fsPath}`, e);
        return '';
    }
};
exports.getContentFromFilesystem = getContentFromFilesystem;
class TestFile {
    constructor() {
        this.didResolve = false;
    }
    async updateFromDisk(controller, item) {
        try {
            const content = await (0, exports.getContentFromFilesystem)(item.uri);
            item.error = undefined;
            this.updateFromContents(controller, content, item);
        }
        catch (e) {
            item.error = e.stack;
        }
    }
    /**
     * Parses the tests from the input text, and updates the tests contained
     * by this file to be those from the text,
     */
    updateFromContents(controller, content, item) {
        const ancestors = [{ item, children: [] }];
        const thisGeneration = generationCounter++;
        this.didResolve = true;
        const ascend = (depth) => {
            while (ancestors.length > depth) {
                const finished = ancestors.pop();
                finished.item.children.replace(finished.children);
            }
        };
        parseFeature(content, {
            onTest: (range, testName) => {
                const parent = ancestors[ancestors.length - 1];
                const data = new TestCase(testName, item.uri?.fsPath, thisGeneration);
                const id = `${item.uri}/${data.getLabel()}${(0, node_crypto_1.randomUUID)()}`;
                const tcase = controller.createTestItem(id, data.getLabel(), item.uri);
                exports.testData.set(tcase, data);
                tcase.range = range;
                parent.children.push(tcase);
            }
        });
        ascend(0); // finish and assign children for all remaining items
    }
}
exports.TestFile = TestFile;
class TestCase {
    constructor(testName, testUri, generation) {
        this.testName = testName;
        this.testUri = testUri;
        this.generation = generation;
    }
    getLabel() {
        return this.testName;
    }
    get namePattern() {
        const escapeExamples = this.testName
            .replace(/[-[\]{}()*+?.,^$]/g, '.')
            .replace(/(<.+?>)/g, '.+?');
        return `^${escapeExamples}$`;
    }
    async run(item, options) {
        const config = vscode.workspace.getConfiguration('qavajs');
        const launchCommand = config.get('launchCommand') ?? 'npx qavajs run';
        const command = `${launchCommand} --paths "${this.testUri}" --name "${this.namePattern}" --format summary`;
        options.appendOutput(command);
        return new Promise(resolve => {
            const shell = (0, node_os_1.platform)() === 'win32' ? 'powershell.exe' : '/bin/sh';
            const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
            (0, node_child_process_1.exec)(command, { cwd, shell }, (err, stdout) => {
                options.appendOutput(stdout.replace(/\n/g, '\r\n'));
                if (err) {
                    options.failed(item, new vscode.TestMessage(stdout));
                }
                else if (/scenarios? \(\d+ passed\)/.test(stdout)) {
                    options.passed(item);
                }
                else if (stdout.includes('0 scenarios')) {
                    options.skipped(item);
                }
                resolve();
            });
        });
    }
}
exports.TestCase = TestCase;
const testRe = /(?:Scenario|Scenario Outline): (.+)/;
function parseFeature(text, events) {
    const lines = text.split('\n');
    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
        const line = lines[lineNo];
        const test = testRe.exec(line);
        if (test) {
            const [, testName] = test;
            const range = new vscode.Range(new vscode.Position(lineNo, 0), new vscode.Position(lineNo, test[0].length));
            events.onTest(range, testName);
        }
    }
}
;
//# sourceMappingURL=testTree.js.map