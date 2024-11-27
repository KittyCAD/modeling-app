import { KclError as RustKclError } from '../wasm-lib/kcl/bindings/KclError'
import { Diagnostic as CodeMirrorDiagnostic } from '@codemirror/lint'
import { posToOffset } from '@kittycad/codemirror-lsp-client'
import { Diagnostic as LspDiagnostic } from 'vscode-languageserver-protocol'
import { Text } from '@codemirror/state'

const TOP_LEVEL_MODULE_ID = 0

type ExtractKind<T> = T extends { kind: infer K } ? K : never
export class KCLError extends Error {
  kind: ExtractKind<RustKclError> | 'name'
  sourceRanges: [number, number, number][]
  msg: string

  constructor(
    kind: ExtractKind<RustKclError> | 'name',
    msg: string,
    sourceRanges: [number, number, number][]
  ) {
    super()
    this.kind = kind
    this.msg = msg
    this.sourceRanges = sourceRanges
    Object.setPrototypeOf(this, KCLError.prototype)
  }
}

export class KCLLexicalError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number, number][]) {
    super('lexical', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLInternalError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number, number][]) {
    super('internal', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLSyntaxError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number, number][]) {
    super('syntax', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLSemanticError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number, number][]) {
    super('semantic', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLSemanticError.prototype)
  }
}

export class KCLTypeError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number, number][]) {
    super('type', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLTypeError.prototype)
  }
}

export class KCLUnimplementedError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number, number][]) {
    super('unimplemented', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLUnimplementedError.prototype)
  }
}

export class KCLUnexpectedError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number, number][]) {
    super('unexpected', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLUnexpectedError.prototype)
  }
}

export class KCLValueAlreadyDefined extends KCLError {
  constructor(key: string, sourceRanges: [number, number, number][]) {
    super('name', `Key ${key} was already defined elsewhere`, sourceRanges)
    Object.setPrototypeOf(this, KCLValueAlreadyDefined.prototype)
  }
}

export class KCLUndefinedValueError extends KCLError {
  constructor(key: string, sourceRanges: [number, number, number][]) {
    super('name', `Key ${key} has not been defined`, sourceRanges)
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
          [
            posToOffset(doc, range.start)!,
            posToOffset(doc, range.end)!,
            TOP_LEVEL_MODULE_ID,
          ],
        ])
    )
    .filter(({ sourceRanges }) => {
      const [from, to, moduleId] = sourceRanges[0]
      return (
        from !== null &&
        to !== null &&
        from !== undefined &&
        to !== undefined &&
        // Filter out errors that are not from the top-level module.
        moduleId === TOP_LEVEL_MODULE_ID
      )
    })
    .sort((a, b) => {
      const c = a.sourceRanges[0][0]
      const d = b.sourceRanges[0][0]
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
  return errors?.flatMap((err) => {
    const sourceRanges: CodeMirrorDiagnostic[] = err.sourceRanges
      // Filter out errors that are not from the top-level module.
      .filter(([_start, _end, moduleId]) => moduleId === TOP_LEVEL_MODULE_ID)
      .map(([from, to]) => {
        return { from, to, message: err.msg, severity: 'error' }
      })
    // Make sure we didn't filter out all the source ranges.
    if (sourceRanges.length === 0) {
      sourceRanges.push({ from: 0, to: 0, message: err.msg, severity: 'error' })
    }
    return sourceRanges
  })
}
