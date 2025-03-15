import { KclError as RustKclError } from '@rust/kcl-lib/bindings/KclError'
import { CompilationError } from '@rust/kcl-lib/bindings/CompilationError'
import { Diagnostic as CodeMirrorDiagnostic } from '@codemirror/lint'
import { posToOffset } from '@kittycad/codemirror-lsp-client'
import { Diagnostic as LspDiagnostic } from 'vscode-languageserver-protocol'
import { Text } from '@codemirror/state'
import { EditorView } from 'codemirror'
import {
  ArtifactCommand,
  ArtifactGraph,
  defaultArtifactGraph,
  isTopLevelModule,
  SourceRange,
} from 'lang/wasm'
import { Operation } from '@rust/kcl-lib/bindings/Operation'
import { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import { warn } from 'node:console'

type ExtractKind<T> = T extends { kind: infer K } ? K : never
export class KCLError extends Error {
  kind: ExtractKind<RustKclError> | 'name'
  sourceRange: SourceRange
  msg: string
  operations: Operation[]
  artifactCommands: ArtifactCommand[]
  artifactGraph: ArtifactGraph
  filenames: { [x: number]: ModulePath | undefined }
  defaultPlanes: DefaultPlanes | null

  constructor(
    kind: ExtractKind<RustKclError> | 'name',
    msg: string,
    sourceRange: SourceRange,
    operations: Operation[],
    artifactCommands: ArtifactCommand[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super()
    this.kind = kind
    this.msg = msg
    this.sourceRange = sourceRange
    this.operations = operations
    this.artifactCommands = artifactCommands
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
    operations: Operation[],
    artifactCommands: ArtifactCommand[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'lexical',
      msg,
      sourceRange,
      operations,
      artifactCommands,
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
    operations: Operation[],
    artifactCommands: ArtifactCommand[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'internal',
      msg,
      sourceRange,
      operations,
      artifactCommands,
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
    operations: Operation[],
    artifactCommands: ArtifactCommand[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'syntax',
      msg,
      sourceRange,
      operations,
      artifactCommands,
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
    operations: Operation[],
    artifactCommands: ArtifactCommand[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'semantic',
      msg,
      sourceRange,
      operations,
      artifactCommands,
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
    operations: Operation[],
    artifactCommands: ArtifactCommand[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'type',
      msg,
      sourceRange,
      operations,
      artifactCommands,
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
    operations: Operation[],
    artifactCommands: ArtifactCommand[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'io',
      msg,
      sourceRange,
      operations,
      artifactCommands,
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
    operations: Operation[],
    artifactCommands: ArtifactCommand[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'unexpected',
      msg,
      sourceRange,
      operations,
      artifactCommands,
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
    operations: Operation[],
    artifactCommands: ArtifactCommand[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'name',
      `Key ${key} was already defined elsewhere`,
      sourceRange,
      operations,
      artifactCommands,
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
    operations: Operation[],
    artifactCommands: ArtifactCommand[],
    artifactGraph: ArtifactGraph,
    filenames: { [x: number]: ModulePath | undefined },
    defaultPlanes: DefaultPlanes | null
  ) {
    super(
      'name',
      `Key ${key} has not been defined`,
      sourceRange,
      operations,
      artifactCommands,
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
  return errors
    ?.filter((err) => isTopLevelModule(err.sourceRange))
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
