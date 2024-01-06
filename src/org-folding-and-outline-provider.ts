import {
    CancellationToken,
    DocumentSymbolProvider,
    FoldingRange,
    FoldingRangeProvider,
    Position,
    ProviderResult,
    Range,
    SymbolInformation,
    SymbolKind,
    TextDocument
} from 'vscode';
import * as utils from './utils';

interface IChunk {
    title: string;
    level: number;
    sectionNumber: string;
    startLine: number;
}

export class OrgFoldingAndOutlineProvider implements FoldingRangeProvider, DocumentSymbolProvider {
    private documentStateRegistry: WeakMap<TextDocument, OrgFoldingAndOutlineDocumentState>;

    constructor() {
        this.documentStateRegistry = new WeakMap();
    }

    public provideFoldingRanges(
        document: TextDocument,
        token: CancellationToken
    ): ProviderResult<FoldingRange[]> {
        const state = this.getOrCreateDocumentState(document);
        return state.getRanges(document);
    }

    public provideDocumentSymbols(
        document: TextDocument,
        token: CancellationToken
    ): ProviderResult<SymbolInformation[]> {
        const state = this.getOrCreateDocumentState(document);
        return state.getSymbols(document);
    }

    private getOrCreateDocumentState(document: TextDocument): OrgFoldingAndOutlineDocumentState {
        let state = this.documentStateRegistry.get(document);
        if (!state) {
            state = new OrgFoldingAndOutlineDocumentState();
            this.documentStateRegistry.set(document, state);
        }
        return state;
    }
}

// tslint:disable-next-line:max-classes-per-file
class OrgFoldingAndOutlineDocumentState {
    private computedForDocumentVersion: number = null;
    private ranges: FoldingRange[] = [];
    private symbols: SymbolInformation[] = [];

    public getRanges(document: TextDocument): FoldingRange[] {
        this.compute(document);
        return this.ranges;
    }

    public getSymbols(document: TextDocument): SymbolInformation[] {
        this.compute(document);
        return this.symbols;
    }

    private compute(document: TextDocument) {
        if (document.version === this.computedForDocumentVersion) {
            return;
        }
        this.computedForDocumentVersion = document.version;
        this.ranges = [];
        this.symbols = [];

        const count = document.lineCount;
        const stack: IChunk[] = [];

        let currentIndices = [];

        for (let lineNumber = 0; lineNumber < count; lineNumber++) {
            const element = document.lineAt(lineNumber);
            const text = element.text;

            if (utils.isHeaderLine(text)) {
                const currentLevel = utils.getStarPrefixCount(text);

                const indexLength = currentIndices.length;
                if (currentLevel > indexLength) {
                    for (let i = indexLength; i < currentLevel; i++) {
                        currentIndices.push(1);
                    }
                } else if (currentLevel < indexLength) {
                    for (let i = currentLevel; i < indexLength; i++) {
                        currentIndices.pop();
                    }
                } else {
                    const idx = currentIndices.pop();
                    currentIndices.push(idx + 1);
                }

                // close previous sections
                while (stack.length > 0 && stack[stack.length - 1].level >= currentLevel) {
                    const localTop = stack.pop();
                    this.createSection(localTop, lineNumber - 1);
                }

                const title = utils.getHeaderTitle(text);
                stack.push({
                    title,
                    level: currentLevel,
                    sectionNumber: currentIndices.join('.'),
                    startLine: lineNumber
                });
            }
        }

        let top: IChunk;
        while ((top = stack.pop()) != null) {
            this.createSection(top, count - 1);
        }
    }

    private createSection(chunk: IChunk, endLine) {
        this.ranges.push(new FoldingRange(chunk.startLine, endLine));
        this.symbols.push(
            new SymbolInformation(
                `${chunk.sectionNumber}. ${chunk.title}`,
                SymbolKind.Field,
                new Range(new Position(chunk.startLine, 0), new Position(endLine, 0))
            )
        );
    }
}
