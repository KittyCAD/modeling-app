import type { Diagnostic as CodeMirrorDiagnostic } from '@codemirror/lint'
import { lspCodeActionEvent } from '@kittycad/codemirror-lsp-client'
import type { EditorView } from 'codemirror'

import type { CompilationIssue } from '@rust/kcl-lib/bindings/CompilationIssue'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type { KclError as RustKclError } from '@rust/kcl-lib/bindings/KclError'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'

import type { BacktraceItem } from '@rust/kcl-lib/bindings/BacktraceItem'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import { sourceRangeContains } from '@src/lang/sourceRange'
import { isTopLevelModule } from '@src/lang/util'
import type {
  ArtifactGraph,
  OperationsByModule,
  VariableMap,
} from '@src/lang/wasm'

type ExtractKind<T> = T extends { kind: infer K } ? K : never
export class KCLError extends Error {
  kind: ExtractKind<RustKclError> | 'name'
  sourceRange: SourceRange
  msg: string
  kclBacktrace: BacktraceItem[]
  nonFatal: CompilationIssue[]
  variables: VariableMap
  operations: OperationsByModule
  artifactGraph: ArtifactGraph
  filenames: { [x: number]: ModulePath | undefined }
  defaultPlanes: DefaultPlanes | null

  constructor(
    kind: ExtractKind<RustKclError> | 'name',
    msg: string,
    sourceRange: SourceRange,
    kclBacktrace: BacktraceItem[],
    nonFatal: CompilationIssue[],
    variables: VariableMap,
    operations: OperationsByModule,
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
 * Helper to convert a source range of UTF-8 values into a UTF-16 one.
 */
export function sourceRangeToUtf16(
  s: SourceRange,
  source: string
): SourceRange {
  const t = (n: number) => toUtf16(n, source)
  return [t(s[0]), t(s[1]), t(s[2])]
}

// When a backtrace has more than twice this many lines, elide the middle,
// keeping this many innermost and outermost frames.
const BACKTRACE_EDGE_LINES = 15

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
        // Recursive calls repeat the same call site; one hint diagnostic per
        // source range is enough.
        const hintRanges = new Set<string>()
        for (let i = 0; i < err.kclBacktrace.length; i++) {
          const item = err.kclBacktrace[i]
          if (
            i > 0 &&
            isTopLevelModule(item.sourceRange) &&
            !sourceRangeContains(item.sourceRange, err.sourceRange)
          ) {
            const rangeKey = `${item.sourceRange[0]}:${item.sourceRange[1]}`
            if (!hintRanges.has(rangeKey)) {
              hintRanges.add(rangeKey)
              diagnostics.push({
                from: toUtf16(item.sourceRange[0], sourceCode),
                to: toUtf16(item.sourceRange[1], sourceCode),
                message: 'Part of the error backtrace',
                severity: 'hint',
              })
            }
          }
          if (i === err.kclBacktrace.length - 1 && !item.fnName) {
            // The top-level doesn't have a name.
            break
          }
          // Import frames are already labeled like `import foo.kcl`;
          // rendering call parens only makes sense for function frames.
          let name: string
          switch (item.kind) {
            case 'call':
              name = item.fnName ? `${item.fnName}()` : '(anonymous)'
              break
            case 'import':
              name = item.fnName ?? '(import)'
              break
            default:
              const _exhaustiveCheck: never = item.kind
              name = '(unknown)'
              break
          }
          backtraceLines.push(name)
        }
        // Deep recursion can produce a huge backtrace. The innermost and
        // outermost frames are the informative ones, so elide the middle.
        if (backtraceLines.length > 2 * BACKTRACE_EDGE_LINES) {
          const omitted = backtraceLines.length - 2 * BACKTRACE_EDGE_LINES
          backtraceLines.splice(
            BACKTRACE_EDGE_LINES,
            omitted,
            `(${omitted} ${omitted === 1 ? 'frame' : 'frames'} omitted)`
          )
        }
        // A single function frame repeats what the squiggle already points
        // at, so it's not helpful to show. But a lone import frame is the
        // only sign that the error lives in another file, so show it.
        const hasImportFrame = err.kclBacktrace.some(
          (item) => item.kind === 'import'
        )
        if (
          backtraceLines.length > 1 ||
          (hasImportFrame && backtraceLines.length === 1)
        ) {
          message += `\n\nBacktrace:\n${backtraceLines.join('\n')}`
        }
      }
      if (err.nonFatal.length > 0) {
        nonFatal = nonFatal.concat(
          compilationIssuesToDiagnostics(err.nonFatal, sourceCode)
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

export function compilationIssuesToDiagnostics(
  issues: CompilationIssue[],
  sourceCode: string
): CodeMirrorDiagnostic[] {
  return issues
    ?.filter((issue) => isTopLevelModule(issue.sourceRange))
    .map((issue) => {
      let severity: any = 'error'
      if (issue.severity === 'Warning') {
        severity = 'warning'
      }
      let actions
      const suggestion = issue.suggestion
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
        from: toUtf16(issue.sourceRange[0], sourceCode),
        to: toUtf16(issue.sourceRange[1], sourceCode),
        message: issue.message,
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
