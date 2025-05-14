"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const language_server_1 = require("@cucumber/language-server");
const language_service_1 = require("@cucumber/language-service");
//@ts-ignore
class QavajsLanguageServer extends language_server_1.CucumberLanguageServer {
    constructor() {
        super(...arguments);
        this.suggestions = [];
    }
    async sendDiagnostics(textDocument) {
        // disable cucumber undefined step diagnostics
        const diagnostics = (0, language_service_1.getGherkinDiagnostics)(textDocument.getText(), (this.expressionBuilderResult?.expressionLinks || []).map((l) => l.expression)).filter((d) => d.code !== 'cucumber.undefined-step');
        await this.connection.sendDiagnostics({
            uri: textDocument.uri,
            diagnostics,
        });
    }
}
exports.default = QavajsLanguageServer;
//# sourceMappingURL=QavajsLanguageServer.js.map