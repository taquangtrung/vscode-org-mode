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

enum ChunkType {
    Section,
    Block,
    Drawer,
    ListItem
}

interface IChunk {
    title: string;
    type: ChunkType;
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

        let inBlock = false;
        let inDrawer = false;

        let currentIndices = [];

        for (let lineNumber = 0; lineNumber < count; lineNumber++) {
            const element = document.lineAt(lineNumber);
            const text = element.text;

            if (inBlock) {
                if (utils.isBlockEndLine(text)) {
                    inBlock = false;
                    if (stack.length > 0 && stack[stack.length - 1].type === ChunkType.Block) {
                        const localTop = stack.pop();
                        this.createSection(localTop, lineNumber);
                    }
                }
            } else if (inDrawer) {
                if (utils.isDrawerEndLine(text)) {
                    inDrawer = false;
                    if (stack.length > 0 && stack[stack.length - 1].type === ChunkType.Drawer) {
                        const localTop = stack.pop();
                        this.createSection(localTop, lineNumber);
                    }
                }
            } else if (utils.isBlockStartLine(text)) {
                inBlock = true;
                stack.push({
                    title: '',
                    type: ChunkType.Block,
                    level: 0,
                    sectionNumber: '',
                    startLine: lineNumber
                });
            } else if (utils.isDrawerStartLine(text)) {
                inDrawer = true;
                stack.push({
                    title: '',
                    type: ChunkType.Drawer,
                    level: 0,
                    sectionNumber: '',
                    startLine: lineNumber
                });
            } else if (utils.isHeaderLine(text)) {
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
                let top = null;
                while (
                    stack.length > 0 &&
                    (top = stack[stack.length - 1]) &&
                    ((top.type === ChunkType.Section && top.level >= currentLevel) ||
                        top.type !== ChunkType.Section)
                ) {
                    const localTop = stack.pop();
                    this.createSection(localTop, lineNumber - 1);
                }

                const title = utils.getHeaderTitle(text);
                stack.push({
                    title,
                    type: ChunkType.Section,
                    level: currentLevel,
                    sectionNumber: currentIndices.join('.'),
                    startLine: lineNumber
                });
            } else if (utils.isListItemLine(text)) {
                const currentLevel = utils.getWhitespacePrefixCount(text);

                // close previous list item
                let top = null;
                while (
                    stack.length > 0 &&
                    (top = stack[stack.length - 1]) &&
                    top.type === ChunkType.ListItem &&
                    top.level >= currentLevel
                ) {
                    const localTop = stack.pop();
                    this.createSection(localTop, lineNumber - 1);
                }

                const title = utils.getHeaderTitle(text);
                stack.push({
                    title,
                    type: ChunkType.ListItem,
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

        if (chunk.type === ChunkType.Section) {
            this.symbols.push(
                new SymbolInformation(
                    `${chunk.sectionNumber}. ${chunk.title}`,
                    SymbolKind.Field,
                    new Range(new Position(chunk.startLine, 0), new Position(endLine, 0))
                )
            );
        }
    }
}
