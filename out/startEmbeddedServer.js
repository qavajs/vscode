"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extname = extname;
exports.startEmbeddedServer = startEmbeddedServer;
const wasm_1 = require("@cucumber/language-service/wasm");
const stream_1 = require("stream");
const vscode_languageserver_1 = require("vscode-languageserver");
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const QavajsLanguageServer_1 = __importDefault(require("./QavajsLanguageServer"));
function extname(uri) {
    return uri.substring(uri.lastIndexOf('.'), uri.length) || '';
}
function startEmbeddedServer(wasmBaseUrl, makeFiles, onReindexed) {
    const adapter = new wasm_1.WasmParserAdapter(wasmBaseUrl);
    const inputStream = new stream_1.PassThrough();
    const outputStream = new stream_1.PassThrough();
    const connection = (0, node_1.createConnection)(inputStream, outputStream);
    const documents = new vscode_languageserver_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
    const server = new QavajsLanguageServer_1.default(connection, documents, adapter, makeFiles, onReindexed);
    connection.listen();
    return {
        writer: inputStream,
        reader: outputStream,
        server,
        connection,
    };
}
//# sourceMappingURL=startEmbeddedServer.js.map