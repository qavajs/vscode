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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const testExplorer_1 = __importDefault(require("./testExplorer"));
const startEmbeddedServer_1 = require("./startEmbeddedServer");
const node_1 = require("vscode-languageclient/node");
const VscodeFiles_1 = require("./VscodeFiles");
let client;
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
async function activate(context) {
    (0, testExplorer_1.default)(context);
    const serverOptions = async () => (0, startEmbeddedServer_1.startEmbeddedServer)(__dirname, () => new VscodeFiles_1.VscodeFiles(vscode.workspace.fs), () => undefined);
    const clientOptions = {
        // We need to list all supported languages here so that
        // the language server is notified to reindex when a file changes
        // https://code.visualstudio.com/docs/languages/identifiers#_known-language-identifiers
        documentSelector: [
            { scheme: 'file', language: 'cucumber' },
            { scheme: 'file', language: 'javascript' },
            { scheme: 'file', language: 'typescript' },
        ],
    };
    client = new node_1.LanguageClient('Cucumber', 'Cucumber Language Server', serverOptions, clientOptions);
    await client.start();
}
// This method is called when your extension is deactivated
async function deactivate() {
    await client.stop();
}
//# sourceMappingURL=extension.js.map