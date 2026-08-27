import type { ExecutionDiagnostic } from '@src/contracts/execution'

/**
 * A compilation issue as `parse_wasm` reports it.
 *
 * Declared locally rather than imported from the generated bindings: this is the
 * shape crossing the WASM boundary, and pinning it here means a bindings change
 * shows up as a type error at the one place that has to adapt.
 */
export interface KclCompilationIssue {
  sourceRange: [number, number, number]
  message: string
  severity: 'Warning' | 'Error' | 'Fatal'
}

/** The JSON a hard parse failure is thrown as. */
interface KclThrownError {
  kind?: string
  details?: {
    msg?: string
    sourceRanges?: [number, number, number][]
  }
  msg?: string
  sourceRanges?: [number, number, number][]
}

const severityOf = (
  severity: KclCompilationIssue['severity']
): ExecutionDiagnostic['severity'] =>
  severity === 'Warning' ? 'warning' : 'error'

/**
 * Clamp a source range to the document.
 *
 * A range can point past the end when the content the parser saw is a version
 * ahead of what a consumer holds. CodeMirror throws on an out-of-range
 * diagnostic, so an off-by-one here becomes a crash rather than a bad underline.
 */
function clampRange(
  from: number,
  to: number,
  length: number
): { from: number; to: number } {
  const start = Math.max(0, Math.min(from, length))
  const end = Math.max(start, Math.min(to, length))
  // A zero-width range renders as nothing, so widen it by one where there is
  // room. An error you cannot see is an error you cannot fix.
  if (start === end && length > start) return { from: start, to: start + 1 }
  return { from: start, to: end }
}

export function issuesToDiagnostics(
  issues: readonly KclCompilationIssue[],
  contentLength: number
): ExecutionDiagnostic[] {
  return issues.map((issue) => {
    const [from, to] = issue.sourceRange
    return {
      ...clampRange(from, to, contentLength),
      severity: severityOf(issue.severity),
      message: issue.message,
    }
  })
}

/**
 * Turn a thrown parse failure into one diagnostic.
 *
 * The WASM boundary throws a JSON string rather than a structured error, and the
 * shape has varied between versions, so both the nested and flat forms are
 * accepted and anything unrecognised still produces a diagnostic at the top of
 * the file rather than being swallowed.
 */
export function thrownErrorToDiagnostics(
  thrown: unknown,
  contentLength: number
): ExecutionDiagnostic[] {
  const text = String(
    thrown instanceof Error ? thrown.message : (thrown ?? 'Unknown KCL error')
  )

  let parsed: KclThrownError | null = null
  try {
    parsed = JSON.parse(text) as KclThrownError
  } catch {
    parsed = null
  }

  const message = parsed?.details?.msg ?? parsed?.msg ?? (parsed ? text : text)
  const ranges = parsed?.details?.sourceRanges ?? parsed?.sourceRanges ?? []
  const [first] = ranges

  return [
    {
      ...clampRange(first?.[0] ?? 0, first?.[1] ?? 0, contentLength),
      severity: 'error',
      message,
    },
  ]
}
