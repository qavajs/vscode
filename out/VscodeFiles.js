"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VscodeFiles = void 0;
const vscode_1 = require("vscode");
class VscodeFiles {
    constructor(fs) {
        this.fs = fs;
    }
    async exists(uri) {
        try {
            await this.fs.stat(vscode_1.Uri.parse(uri));
            return true;
        }
        catch {
            return false;
        }
    }
    async readFile(uri) {
        const data = await this.fs.readFile(vscode_1.Uri.parse(uri));
        //@ts-ignore
        return new TextDecoder().decode(data);
    }
    async findUris(glob) {
        const uris = await vscode_1.workspace.findFiles(glob);
        return uris.map((file) => file.toString());
    }
    relativePath(uri) {
        return vscode_1.workspace.asRelativePath(vscode_1.Uri.parse(uri), true);
    }
}
exports.VscodeFiles = VscodeFiles;
//# sourceMappingURL=VscodeFiles.js.map