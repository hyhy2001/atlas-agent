export interface Position { line: number; character: number }
export interface Range { start: Position; end: Position }
export interface Location { uri: string; range: Range }
export interface LocationLink {
  targetUri: string;
  targetRange: Range;
  targetSelectionRange: Range;
}
export interface MarkupContent { kind: "plaintext" | "markdown"; value: string }
export interface Hover {
  contents: string | MarkupContent | Array<string | MarkupContent>;
  range?: Range;
}
export interface Diagnostic {
  range: Range;
  severity?: 1 | 2 | 3 | 4;
  message: string;
  source?: string;
  code?: string | number;
}
export interface PublishDiagnosticsParams { uri: string; diagnostics: Diagnostic[] }
