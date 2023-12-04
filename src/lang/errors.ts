import { Diagnostic } from '@codemirror/lint'
import { KclError as RustKclError } from '../wasm-lib/kcl/bindings/KclError'

type ExtractKind<T> = T extends { kind: infer K } ? K : never
export class KCLError {
  kind: ExtractKind<RustKclError> | 'name'
  sourceRanges: [number, number][]
  msg: string
  constructor(
    kind: ExtractKind<RustKclError> | 'name',
    msg: string,
    sourceRanges: [number, number][]
  ) {
    this.kind = kind
    this.msg = msg
    this.sourceRanges = sourceRanges
    Object.setPrototypeOf(this, KCLError.prototype)
  }
}

export class KCLLexicalError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number][]) {
    super('lexical', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLInternalError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number][]) {
    super('internal', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLSyntaxError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number][]) {
    super('syntax', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLSemanticError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number][]) {
    super('semantic', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLSemanticError.prototype)
  }
}

export class KCLTypeError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number][]) {
    super('type', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLTypeError.prototype)
  }
}

export class KCLUnimplementedError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number][]) {
    super('unimplemented', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLUnimplementedError.prototype)
  }
}

export class KCLUnexpectedError extends KCLError {
  constructor(msg: string, sourceRanges: [number, number][]) {
    super('unexpected', msg, sourceRanges)
    Object.setPrototypeOf(this, KCLUnexpectedError.prototype)
  }
}

export class KCLValueAlreadyDefined extends KCLError {
  constructor(key: string, sourceRanges: [number, number][]) {
    super('name', `Key ${key} was already defined elsewhere`, sourceRanges)
    Object.setPrototypeOf(this, KCLValueAlreadyDefined.prototype)
  }
}

export class KCLUndefinedValueError extends KCLError {
  constructor(key: string, sourceRanges: [number, number][]) {
    super('name', `Key ${key} has not been defined`, sourceRanges)
    Object.setPrototypeOf(this, KCLUndefinedValueError.prototype)
  }
}

/**
 * Maps the KCL errors to an array of CodeMirror diagnostics.
 * Currently the diagnostics are all errors, but in the future they could include lints.
 * */
export function kclErrToDiagnostic(errors: KCLError[]): Diagnostic[] {
  return errors?.flatMap((err) => {
    return err.sourceRanges.map(([from, to]) => {
      return { from, to, message: err.msg, severity: 'error' }
    })
  })
}
