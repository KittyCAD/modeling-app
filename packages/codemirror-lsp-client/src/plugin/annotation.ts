import { Annotation } from '@codemirror/state'

export enum LspAnnotation {
  SemanticTokens = 'semantic-tokens',
  FormatCode = 'format-code',
  Diagnostics = 'diagnostics',
  Rename = 'rename',
}

const lspEvent = Annotation.define<LspAnnotation>()
export const lspSemanticTokensEvent = lspEvent.of(LspAnnotation.SemanticTokens)
export const lspFormatCodeEvent = lspEvent.of(LspAnnotation.FormatCode)
export const lspDiagnosticsEvent = lspEvent.of(LspAnnotation.Diagnostics)
export const lspRenameEvent = lspEvent.of(LspAnnotation.Rename)
