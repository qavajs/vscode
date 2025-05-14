import { CucumberLanguageServer } from "@cucumber/language-server";
import { 
    getGherkinDiagnostics,
    SuggestionSegments,
} from "@cucumber/language-service";
import { TextDocument } from "vscode";
import { Diagnostic } from "vscode-languageserver";

//@ts-ignore
export default class QavajsLanguageServer extends CucumberLanguageServer {
    public connection: any;
    public documents: any;
    public expressionBuilderResult: any;
    public suggestions: { label: string; segments: SuggestionSegments; matched: boolean; }[] = [];

    async sendDiagnostics(textDocument: TextDocument): Promise<void> {
        // disable cucumber undefined step diagnostics
        const diagnostics = getGherkinDiagnostics(
            textDocument.getText(),
            (this.expressionBuilderResult?.expressionLinks || []).map((l: any) => l.expression)
        ).filter((d: Diagnostic) => d.code !== 'cucumber.undefined-step')
        await this.connection.sendDiagnostics({
            uri: textDocument.uri,
            diagnostics,
        })
    }

}