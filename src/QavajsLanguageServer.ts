import { CucumberLanguageServer } from "@cucumber/language-server";
import { getGherkinDiagnostics, SuggestionSegments, jsSearchIndex } from "@cucumber/language-service";
import { TextDocument } from "vscode";
import { Diagnostic, Connection } from "vscode-languageserver";
import { getTemplates } from "./getTemplates";

//@ts-ignore
export default class QavajsLanguageServer extends CucumberLanguageServer {
    public connection: any;
    public expressionBuilderResult: any;
    public suggestions: { label: string; segments: SuggestionSegments; matched: boolean; }[] = [];
    async sendDiagnostics(textDocument: TextDocument): Promise<void> {
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
        this.suggestions.push(
            ...(await getTemplates()).map(s => { 
                let tagIndex = 0;
                const segments = s.replace(/<.+?>/g, () => {
                  tagIndex++;
                  return `||\${${tagIndex}}||`;
                });
                return { label: s, segments: segments.split('||'), matched: true}
            })
        );
        this.suggestions = this.suggestions.map(s => ({...s, segments: s.segments.map((param, index) => Array.isArray(param) ? `\${${index}}` : param)}));                        
        //@ts-ignore
        this.onReindexed(this.registry, this.expressions, this.suggestions);
        //@ts-ignore
        this.searchIndex = jsSearchIndex(this.suggestions);
    }

}