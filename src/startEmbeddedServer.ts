import { CucumberExpressions, ParserAdapter, Suggestion } from '@cucumber/language-service'
import { WasmParserAdapter } from '@cucumber/language-service/wasm'
import { PassThrough } from 'stream'
import { Connection, TextDocuments } from 'vscode-languageserver'
import { createConnection } from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'

import QavajsLanguageServer from './QavajsLanguageServer'

export interface Files {
    exists(uri: string): Promise<boolean>
    readFile(uri: string): Promise<string>
    findUris(glob: string): Promise<readonly string[]>
    relativePath(uri: string): string
  }
  
export function extname(uri: string): string {
return uri.substring(uri.lastIndexOf('.'), uri.length) || ''
}

export type ServerInfo = {
  writer: NodeJS.WritableStream
  reader: NodeJS.ReadableStream
  server: QavajsLanguageServer
  connection: Connection
}

export function startEmbeddedServer(
  wasmBaseUrl: string,
  makeFiles: (rootUri: string) => Files,
  onReindexed: (
    registry: CucumberExpressions.ParameterTypeRegistry,
    expressions: readonly CucumberExpressions.Expression[],
    suggestions: readonly Suggestion[]
  ) => void
): ServerInfo {
  const adapter: ParserAdapter = new WasmParserAdapter(wasmBaseUrl)
  const inputStream = new PassThrough()
  const outputStream = new PassThrough()

  const connection = createConnection(inputStream, outputStream)
  const documents = new TextDocuments(TextDocument)
  const server = new QavajsLanguageServer(connection, documents, adapter, makeFiles, onReindexed)
  connection.listen()

  return {
    writer: inputStream,
    reader: outputStream,
    server,
    connection,
  }
}