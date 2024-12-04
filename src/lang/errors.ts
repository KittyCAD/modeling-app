import { KclError as RustKclError } from '../wasm-lib/kcl/bindings/KclError'
import { CompilationError } from 'wasm-lib/kcl/bindings/CompilationError'
import { Diagnostic as CodeMirrorDiagnostic } from '@codemirror/lint'
import { posToOffset } from '@kittycad/codemirror-lsp-client'
import { Diagnostic as LspDiagnostic } from 'vscode-languageserver-protocol'
import { Text } from '@codemirror/state'
import { EditorView } from 'codemirror'
import { SourceRange } from 'lang/wasm'

type ExtractKind<T> = T extends { kind: infer K } ? K : never
export class KCLError extends Error {
  kind: ExtractKind<RustKclError> | 'name'
  sourceRange: SourceRange
  msg: string

  constructor(
    kind: ExtractKind<RustKclError> | 'name',
    msg: string,
    sourceRange: SourceRange
  ) {
    super()
    this.kind = kind
    this.msg = msg
    this.sourceRange = sourceRange
    Object.setPrototypeOf(this, KCLError.prototype)
  }
}

export class KCLLexicalError extends KCLError {
  constructor(msg: string, sourceRange: SourceRange) {
    super('lexical', msg, sourceRange)
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLInternalError extends KCLError {
  constructor(msg: string, sourceRange: SourceRange) {
    super('internal', msg, sourceRange)
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLSyntaxError extends KCLError {
  constructor(msg: string, sourceRange: SourceRange) {
    super('syntax', msg, sourceRange)
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLSemanticError extends KCLError {
  constructor(msg: string, sourceRange: SourceRange) {
    super('semantic', msg, sourceRange)
    Object.setPrototypeOf(this, KCLSemanticError.prototype)
  }
}

export class KCLTypeError extends KCLError {
  constructor(msg: string, sourceRange: SourceRange) {
    super('type', msg, sourceRange)
    Object.setPrototypeOf(this, KCLTypeError.prototype)
  }
}

export class KCLUnimplementedError extends KCLError {
  constructor(msg: string, sourceRange: SourceRange) {
    super('unimplemented', msg, sourceRange)
    Object.setPrototypeOf(this, KCLUnimplementedError.prototype)
  }
}

export class KCLUnexpectedError extends KCLError {
  constructor(msg: string, sourceRange: SourceRange) {
    super('unexpected', msg, sourceRange)
    Object.setPrototypeOf(this, KCLUnexpectedError.prototype)
  }
}

export class KCLValueAlreadyDefined extends KCLError {
  constructor(key: string, sourceRange: SourceRange) {
    super('name', `Key ${key} was already defined elsewhere`, sourceRange)
    Object.setPrototypeOf(this, KCLValueAlreadyDefined.prototype)
  }
}

export class KCLUndefinedValueError extends KCLError {
  constructor(key: string, sourceRange: SourceRange) {
    super('name', `Key ${key} has not been defined`, sourceRange)
    Object.setPrototypeOf(this, KCLUndefinedValueError.prototype)
  }
}

/**
 * Maps the lsp diagnostic to an array of KclErrors.
 * Currently the diagnostics are all errors, but in the future they could include lints.
 * */
export function lspDiagnosticsToKclErrors(
  doc: Text,
  diagnostics: LspDiagnostic[]
): KCLError[] {
  return diagnostics
    .flatMap(
      ({ range, message }) =>
        new KCLError('unexpected', message, [
          posToOffset(doc, range.start)!,
          posToOffset(doc, range.end)!,
          true,
        ])
    )
    .sort((a, b) => {
      const c = a.sourceRange[0]
      const d = b.sourceRange[0]
      switch (true) {
        case c < d:
          return -1
        case c > d:
          return 1
      }
      return 0
    })
}

/**
 * Maps the KCL errors to an array of CodeMirror diagnostics.
 * Currently the diagnostics are all errors, but in the future they could include lints.
 * */
export function kclErrorsToDiagnostics(
  errors: KCLError[]
): CodeMirrorDiagnostic[] {
  return errors
    ?.filter((err) => err.sourceRange[2])
    .map((err) => {
      return {
        from: err.sourceRange[0],
        to: err.sourceRange[1],
        message: err.msg,
        severity: 'error',
      }
    })
}

export function complilationErrorsToDiagnostics(
  errors: CompilationError[]
): CodeMirrorDiagnostic[] {
  return errors
    ?.filter((err) => err.sourceRange[2] === 0)
    .map((err) => {
      let severity: any = 'error'
      if (err.severity === 'Warning') {
        severity = 'warning'
      }
      let actions
      const suggestion = err.suggestion
      if (suggestion) {
        actions = [
          {
            name: suggestion.title,
            apply: (view: EditorView, from: number, to: number) => {
              view.dispatch({
                changes: { from, to, insert: suggestion.insert },
              })
            },
          },
        ]
      }
      return {
        from: err.sourceRange[0],
        to: err.sourceRange[1],
        message: err.message,
        severity,
        actions,
      }
    })
}
