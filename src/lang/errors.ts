import type { Diagnostic as CodeMirrorDiagnostic } from '@codemirror/lint'
import { lspCodeActionEvent } from '@kittycad/codemirror-lsp-client'
import type { EditorView } from 'codemirror'

import type { CompilationError } from '@rust/kcl-lib/bindings/CompilationError'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type { KclError as RustKclError } from '@rust/kcl-lib/bindings/KclError'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'

import type { BacktraceItem } from '@rust/kcl-lib/bindings/BacktraceItem'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import { sourceRangeContains } from '@src/lang/sourceRange'
import { isTopLevelModule } from '@src/lang/util'
import type { ArtifactGraph, VariableMap } from '@src/lang/wasm'

type ExtractKind<T> = T extends { kind: infer K } ? K : never
export class KCLError extends Error {
  kind: ExtractKind<RustKclError> | 'name'
  sourceRange: SourceRange
  msg: string
  kclBacktrace: BacktraceItem[]
  nonFatal: CompilationError[]
  variables: VariableMap
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
    variables: VariableMap,
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
    this.variables = variables
    this.operations = operations
    this.artifactGraph = artifactGraph
    this.filenames = filenames
    this.defaultPlanes = defaultPlanes
    Object.setPrototypeOf(this, KCLError.prototype)
  }
}
/**
Convert this UTF-16 source range offset to UTF-8 as SourceRange is always a UTF-8
*/
export function toUtf8(
  utf16SourceRange: SourceRange,
  sourceCode: string
): SourceRange {
  const moduleId = utf16SourceRange[2]
  const textEncoder = new TextEncoder()
  const prefixUtf16 = sourceCode.slice(0, utf16SourceRange[0])
  const prefixUtf8 = textEncoder.encode(prefixUtf16)
  const prefixLen = prefixUtf8.length
  const toHighlightUtf16 = sourceCode.slice(
    utf16SourceRange[0],
    utf16SourceRange[1]
  )
  const toHighlightUtf8 = textEncoder.encode(toHighlightUtf16)
  const toHighlightLen = toHighlightUtf8.length
  return [prefixLen, prefixLen + toHighlightLen, moduleId]
}

/**
Convert this UTF-8 source range offset to UTF-16 for display in CodeMirror,
as it relies on JS-style string encoding which is UTF-16.
*/
export function toUtf16(utf8Offset: number, sourceCode: string): number {
  const sourceUtf8 = new TextEncoder().encode(sourceCode)
  const prefix = sourceUtf8.slice(0, utf8Offset)
  const backTo16 = new TextDecoder().decode(prefix)
  return backTo16.length
}

/**
 * Maps the KCL errors to an array of CodeMirror diagnostics.
 * Currently the diagnostics are all errors, but in the future they could include lints.
 * */
export function kclErrorsToDiagnostics(
  errors: KCLError[],
  sourceCode: string
): CodeMirrorDiagnostic[] {
  let nonFatal: CodeMirrorDiagnostic[] = []
  const errs = errors
    ?.filter((err) => isTopLevelModule(err.sourceRange))
    .flatMap((err) => {
      const diagnostics: CodeMirrorDiagnostic[] = []
      let message = err.msg
      if (err.kclBacktrace.length > 0) {
        // Show the backtrace in the error message.
        const backtraceLines: Array<string> = []
        for (let i = 0; i < err.kclBacktrace.length; i++) {
          const item = err.kclBacktrace[i]
          if (
            i > 0 &&
            isTopLevelModule(item.sourceRange) &&
            !sourceRangeContains(item.sourceRange, err.sourceRange)
          ) {
            diagnostics.push({
              from: toUtf16(item.sourceRange[0], sourceCode),
              to: toUtf16(item.sourceRange[1], sourceCode),
              message: 'Part of the error backtrace',
              severity: 'hint',
            })
          }
          if (i === err.kclBacktrace.length - 1 && !item.fnName) {
            // The top-level doesn't have a name.
            break
          }
          const name = item.fnName ? `${item.fnName}()` : '(anonymous)'
          backtraceLines.push(name)
        }
        // If the backtrace is only one line, it's not helpful to show.
        if (backtraceLines.length > 1) {
          message += `\n\nBacktrace:\n${backtraceLines.join('\n')}`
        }
      }
      if (err.nonFatal.length > 0) {
        nonFatal = nonFatal.concat(
          compilationErrorsToDiagnostics(err.nonFatal, sourceCode)
        )
      }
      diagnostics.push({
        from: toUtf16(err.sourceRange[0], sourceCode),
        to: toUtf16(err.sourceRange[1], sourceCode),
        message,
        severity: 'error',
      })
      return diagnostics
    })
  return errs.concat(nonFatal)
}

export function compilationErrorsToDiagnostics(
  errors: CompilationError[],
  sourceCode: string
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
                  from: toUtf16(suggestion.source_range[0], sourceCode),
                  to: toUtf16(suggestion.source_range[1], sourceCode),
                  insert: suggestion.insert,
                },
                annotations: [lspCodeActionEvent],
              })
            },
          },
        ]
      }
      return {
        from: toUtf16(err.sourceRange[0], sourceCode),
        to: toUtf16(err.sourceRange[1], sourceCode),
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
