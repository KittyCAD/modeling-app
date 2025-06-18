import type { Diagnostic as CodeMirrorDiagnostic } from '@codemirror/lint'
import type { Text } from '@codemirror/state'
import {
  lspCodeActionEvent,
  posToOffset,
} from '@kittycad/codemirror-lsp-client'
import type { EditorView } from 'codemirror'
import type { Diagnostic as LspDiagnostic } from 'vscode-languageserver-protocol'

import type { CompilationError } from '@rust/kcl-lib/bindings/CompilationError'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type { KclError as RustKclError } from '@rust/kcl-lib/bindings/KclError'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'

import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import { defaultArtifactGraph } from '@src/lang/std/artifactGraph'
import { isTopLevelModule } from '@src/lang/util'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { BacktraceItem } from '@rust/kcl-lib/bindings/BacktraceItem'

type ExtractKind<T> = T extends { kind: infer K } ? K : never
export class KCLError extends Error {
  kind: ExtractKind<RustKclError> | 'name'
  sourceRange: SourceRange
  msg: string
  kclBacktrace: BacktraceItem[]
  nonFatal: CompilationError[]
  operations: Operation[]
  artifactGraph: ArtifactGraph
  filenames: { [x: number]: ModulePath | undefined }
  defaultPlanes: DefaultPlanes | null

  constructor(
    kind: ExtractKind<RustKclError> | 'name',
    msg: string,
    sourceRange: SourceRange,
    kclBacktrace: BacktraceItem[],
    nonFatal: CompilationError[],
    operations: Operation[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(`${kind}: ${msg}`)
    this.kind = kind
    this.msg = msg
    this.sourceRange = sourceRange
    this.kclBacktrace = kclBacktrace
    this.nonFatal = nonFatal
    this.operations = operations
    this.artifactGraph = artifactGraph
    this.filenames = filenames
    this.defaultPlanes = defaultPlanes
    Object.setPrototypeOf(this, KCLError.prototype)
  }
}

export class KCLLexicalError extends KCLError {
  constructor(
    msg: string,
    sourceRange: SourceRange,
    kclBacktrace: BacktraceItem[],
    nonFatal: CompilationError[],
    operations: Operation[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'lexical',
      msg,
      sourceRange,
      kclBacktrace,
      nonFatal,
      operations,
      artifactGraph,
      filenames,
      defaultPlanes
    )
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLInternalError extends KCLError {
  constructor(
    msg: string,
    sourceRange: SourceRange,
    kclBacktrace: BacktraceItem[],
    nonFatal: CompilationError[],
    operations: Operation[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'internal',
      msg,
      sourceRange,
      kclBacktrace,
      nonFatal,
      operations,
      artifactGraph,
      filenames,
      defaultPlanes
    )
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLSyntaxError extends KCLError {
  constructor(
    msg: string,
    sourceRange: SourceRange,
    kclBacktrace: BacktraceItem[],
    nonFatal: CompilationError[],
    operations: Operation[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'syntax',
      msg,
      sourceRange,
      kclBacktrace,
      nonFatal,
      operations,
      artifactGraph,
      filenames,
      defaultPlanes
    )
    Object.setPrototypeOf(this, KCLSyntaxError.prototype)
  }
}

export class KCLSemanticError extends KCLError {
  constructor(
    msg: string,
    sourceRange: SourceRange,
    kclBacktrace: BacktraceItem[],
    nonFatal: CompilationError[],
    operations: Operation[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'semantic',
      msg,
      sourceRange,
      kclBacktrace,
      nonFatal,
      operations,
      artifactGraph,
      filenames,
      defaultPlanes
    )
    Object.setPrototypeOf(this, KCLSemanticError.prototype)
  }
}

export class KCLTypeError extends KCLError {
  constructor(
    msg: string,
    sourceRange: SourceRange,
    kclBacktrace: BacktraceItem[],
    nonFatal: CompilationError[],
    operations: Operation[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'type',
      msg,
      sourceRange,
      kclBacktrace,
      nonFatal,
      operations,
      artifactGraph,
      filenames,
      defaultPlanes
    )
    Object.setPrototypeOf(this, KCLTypeError.prototype)
  }
}

export class KCLIoError extends KCLError {
  constructor(
    msg: string,
    sourceRange: SourceRange,
    kclBacktrace: BacktraceItem[],
    nonFatal: CompilationError[],
    operations: Operation[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'io',
      msg,
      sourceRange,
      kclBacktrace,
      nonFatal,
      operations,
      artifactGraph,
      filenames,
      defaultPlanes
    )
    Object.setPrototypeOf(this, KCLIoError.prototype)
  }
}

export class KCLUnexpectedError extends KCLError {
  constructor(
    msg: string,
    sourceRange: SourceRange,
    kclBacktrace: BacktraceItem[],
    nonFatal: CompilationError[],
    operations: Operation[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'unexpected',
      msg,
      sourceRange,
      kclBacktrace,
      nonFatal,
      operations,
      artifactGraph,
      filenames,
      defaultPlanes
    )
    Object.setPrototypeOf(this, KCLUnexpectedError.prototype)
  }
}

export class KCLValueAlreadyDefined extends KCLError {
  constructor(
    key: string,
    sourceRange: SourceRange,
    kclBacktrace: BacktraceItem[],
    nonFatal: CompilationError[],
    operations: Operation[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'name',
      `Key ${key} was already defined elsewhere`,
      sourceRange,
      kclBacktrace,
      nonFatal,
      operations,
      artifactGraph,
      filenames,
      defaultPlanes
    )
    Object.setPrototypeOf(this, KCLValueAlreadyDefined.prototype)
  }
}

export class KCLUndefinedValueError extends KCLError {
  constructor(
    key: string,
    sourceRange: SourceRange,
    kclBacktrace: BacktraceItem[],
    nonFatal: CompilationError[],
    operations: Operation[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'name',
      `Key ${key} has not been defined`,
      sourceRange,
      kclBacktrace,
      nonFatal,
      operations,
      artifactGraph,
      filenames,
      defaultPlanes
    )
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
        new KCLError(
          'unexpected',
          message,
          [posToOffset(doc, range.start)!, posToOffset(doc, range.end)!, 0],
          [],
          [],
          [],
          defaultArtifactGraph(),
          {},
          null
        )
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
  let nonFatal: CodeMirrorDiagnostic[] = []
  const errs = errors
    ?.filter((err) => isTopLevelModule(err.sourceRange))
    .flatMap((err) => {
      const diagnostics: CodeMirrorDiagnostic[] = []
      let message = err.msg
      if (err.kclBacktrace.length > 0) {
        // Show the backtrace in the error message.
        for (let i = 0; i < err.kclBacktrace.length; i++) {
          const item = err.kclBacktrace[i]
          if (
            i > 0 &&
            isTopLevelModule(item.sourceRange) &&
            item.sourceRange[0] !== err.sourceRange[0] &&
            item.sourceRange[1] !== err.sourceRange[1]
          ) {
            diagnostics.push({
              from: item.sourceRange[0],
              to: item.sourceRange[1],
              message: 'Part of the error backtrace',
              severity: 'hint',
            })
          }
          if (i === err.kclBacktrace.length - 1 && !item.fnName) {
            // The top-level doesn't have a name.
            break
          }
          const name = item.fnName ? `${item.fnName}()` : '(anonymous)'
          message += `\n${name}`
        }
      }
      if (err.nonFatal.length > 0) {
        nonFatal = nonFatal.concat(compilationErrorsToDiagnostics(err.nonFatal))
      }
      diagnostics.push({
        from: err.sourceRange[0],
        to: err.sourceRange[1],
        message,
        severity: 'error',
      })
      return diagnostics
    })
  return errs.concat(nonFatal)
}

export function compilationErrorsToDiagnostics(
  errors: CompilationError[]
): CodeMirrorDiagnostic[] {
  return errors
    ?.filter((err) => isTopLevelModule(err.sourceRange))
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
                changes: {
                  from: suggestion.source_range[0],
                  to: suggestion.source_range[1],
                  insert: suggestion.insert,
                },
                annotations: [lspCodeActionEvent],
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

// Create an array of KCL Errors with a new formatting to
// easily map SourceRange of an error to the filename to display in the
// side bar UI. This is to indicate an error in an imported file, it isn't
// the specific code mirror error interface.
export function kclErrorsByFilename(
  errors: KCLError[]
): Map<string, KCLError[]> {
  const fileNameToError: Map<string, KCLError[]> = new Map()
  errors.forEach((error: KCLError) => {
    const filenames = error.filenames
    const sourceRange: SourceRange = error.sourceRange
    const fileIndex = sourceRange[2]
    const modulePath: ModulePath | undefined = filenames[fileIndex]
    if (modulePath && modulePath.type === 'Local') {
      let localPath = modulePath.value
      if (localPath) {
        // Build up an array of errors per file name
        const value = fileNameToError.get(localPath)
        if (!value) {
          fileNameToError.set(localPath, [error])
        } else {
          value.push(error)
          fileNameToError.set(localPath, [error])
        }
      }
    }
  })

  return fileNameToError
}
