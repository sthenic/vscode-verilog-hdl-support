import { workspace, window, Disposable, Range, TextDocument, Diagnostic, DiagnosticSeverity, DiagnosticCollection, languages } from "vscode";
import * as child from 'child_process';
import BaseLinter from "./BaseLinter";
import { join } from "path";
import { Logger, Log_Severity } from "../Logger";

var isWindows = process.platform === "win32";

export default class VerilatorLinter extends BaseLinter {
    private verilatorArgs: string;
    private runAtFileLocation: boolean;
    private useWSL: boolean;

    constructor(logger: Logger) {
        super("verilator", logger);

        workspace.onDidChangeConfiguration(() => {
            this.getConfig();
        })
        this.getConfig();
    }

    private getConfig() {
        this.verilatorArgs = <string>workspace.getConfiguration().get('verilog.linting.verilator.arguments', '');
        this.runAtFileLocation = <boolean>workspace.getConfiguration().get('verilog.linting.verilator.runAtFileLocation');
        this.useWSL = <boolean>workspace.getConfiguration().get('verilog.linting.verilator.useWSL');
    }

    protected splitTerms(line: string) {
        let terms = line.split(':');

        for (var i = 0; i < terms.length; i++) {
            if (terms[i] == ' ') {
                terms.splice(i, 1);
                i--;
            }
            else {
                terms[i] = terms[i].trim();
            }
        }

        return terms;
    }

    protected getSeverity(severityString: string) {
        let result = DiagnosticSeverity.Information;

        if (severityString.startsWith('Error')) {
            result = DiagnosticSeverity.Error;
        }
        else if (severityString.startsWith('Warning')) {
            result = DiagnosticSeverity.Warning;
        }

        return result;
    }

    protected lint(doc: TextDocument) {
        this.logger.log('verilator lint requested');
        let docUri: string = doc.uri.fsPath     //path of current doc
        let lastIndex: number = (isWindows == true) ? docUri.lastIndexOf("\\") : docUri.lastIndexOf("/");
        let docFolder = docUri.substr(0, lastIndex);    //folder of current doc
        let runLocation: string = (this.runAtFileLocation == true) ? docFolder : workspace.rootPath;     //choose correct location to run
        let svArgs: string = (doc.languageId == "systemverilog") ? "-sv" : "";                         //Systemverilog args
        let verilator: string = "verilator";
        if (isWindows) {
            if (this.useWSL == true) {
                verilator = `wsl ${verilator}`;
                let docUri_cmd: string = `wsl wslpath '${docUri}'`;
                docUri = child.execSync(docUri_cmd, {}).toString().replace(/\r?\n/g, "");
                this.logger.log(`Rewrote docUri to ${docUri} for WSL`, Log_Severity.Info);

                let docFolder_cmd: string = `wsl wslpath '${docFolder}'`;
                docFolder = child.execSync(docFolder_cmd, {}).toString().replace(/\r?\n/g, "");
                this.logger.log(`Rewrote docFolder to ${docFolder} for WSL`, Log_Severity.Info);
            } else {
                verilator = verilator + "_bin.exe";
                docUri = docUri.replace(/\\/g, "/");
                docFolder = docFolder.replace(/\\/g, "/");
            }
        }
        let command: string = verilator + ' ' + svArgs + ' --lint-only -I' + docFolder + ' ' + this.verilatorArgs + ' \"' + docUri + '\"';     //command to execute
        this.logger.log(command, Log_Severity.Command);

        var foo: child.ChildProcess = child.exec(command, { cwd: runLocation }, (error: Error, stdout: string, stderr: string) => {
            let diagnostics: Diagnostic[] = [];
            let lines = stderr.split(/\r?\n/g);

            // Parse output lines
            lines.forEach((line, i) => {
                if (line.startsWith('%')) {
                    // remove the %
                    line = line.substr(1)

                    // was it for a submodule
                    if (line.search(docUri) > 0) {
                        // remove the filename
                        line = line.replace(docUri, '');
                        line = line.replace(/\s+/g, ' ').trim();

                        let terms = this.splitTerms(line);
                        let severity = this.getSeverity(terms[0]);
                        let message = terms.slice(2).join(' ')
                        let lineNum = parseInt(terms[1].trim()) - 1;

                        if (lineNum != NaN) {
                            console.log(terms[1].trim() + ' ' + message);

                            diagnostics.push({
                                severity: severity,
                                range: new Range(lineNum, 0, lineNum, Number.MAX_VALUE),
                                message: message,
                                code: 'verilator',
                                source: 'verilator'
                            });
                        }
                    }
                }
            })
            this.logger.log(diagnostics.length + ' errors/warnings returned');
            this.diagnostic_collection.set(doc.uri, diagnostics)
        })
    }
}
