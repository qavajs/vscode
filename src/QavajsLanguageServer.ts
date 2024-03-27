import { CucumberLanguageServer } from "@cucumber/language-server";
import { 
    getGherkinDiagnostics,
    SuggestionSegments,
    jsSearchIndex,
    getGherkinFormattingEdits,
} from "@cucumber/language-service";
import { TextDocument } from "vscode";
import { Diagnostic } from "vscode-languageserver";
import { getTemplateCoordinates, getTemplateSuggestions } from "./getTemplates";

//@ts-ignore
export default class QavajsLanguageServer extends CucumberLanguageServer {
    public connection: any;
    public documents: any;
    public expressionBuilderResult: any;
    public suggestions: { label: string; segments: SuggestionSegments; matched: boolean; }[] = [];

    constructor(connection: any, documents: any, parserAdapter: any, makeFiles: any, onReindexed: any) {
        super(connection, documents, parserAdapter, makeFiles, onReindexed);
        connection.onInitialized(async () => {
            // override onDocumentFormatting to suppress removing gherking comments
            connection.onDocumentFormatting((params: any) => {
                const doc = documents.get(params.textDocument.uri);
                if (!doc) return [];
                const gherkinSource = doc.getText().replace(/\#/g, '_HASH_');
                const formattedText = getGherkinFormattingEdits(gherkinSource);
                return formattedText.map((edit: any) => {
                    edit.newText = edit.newText.replace(/_HASH_/g, '#');
                    return edit
                });
            });
        })
    }
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

    //@ts-ignore
    async reindex(settings?: any) {
        //@ts-ignore
        await super.reindex(settings);
        // extend expression lists to add templates
        this.expressionBuilderResult.expressionLinks.push(
            ...(await getTemplateCoordinates(this.expressionBuilderResult.registry))
        )
        console.log(this.expressionBuilderResult.expressionLinks)
        // extend origininal step suggestions with templates
        this.suggestions.push(
            ...(await getTemplateSuggestions())
        );
        this.suggestions = this.suggestions.map(s => ({...s, segments: s.segments.map((param, index) => Array.isArray(param) ? `\${${index}}` : param)}));                        
        //@ts-ignore
        this.onReindexed(this.registry, this.expressions, this.suggestions);
        //@ts-ignore
        this.searchIndex = jsSearchIndex(this.suggestions);
    }

}