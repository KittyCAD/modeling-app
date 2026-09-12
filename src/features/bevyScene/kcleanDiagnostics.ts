import type { ExecutionDiagnostic } from '@src/contracts/execution'
import { byteOffsetToUtf16 } from '@src/lib/kcl/sourceRange'

/** A Kclean diagnostic before its UTF-8 source bytes reach CodeMirror. */
export interface KcleanSourceDiagnostic {
  source: string
  start: number
  end: number
  severity: 'error' | 'warning' | 'info'
  message: string
}

/**
 * Convert Kclean's half-open UTF-8 byte ranges to CodeMirror's UTF-16 offsets.
 *
 * The source text is the submitted snapshot, not whatever happens to be in an
 * editor later. The surface checks those are still identical before publishing,
 * which makes a late kernel result safe to ignore rather than mis-underline.
 */
export function kcleanDiagnosticsForSource(
  source: string,
  diagnostics: readonly KcleanSourceDiagnostic[]
): ExecutionDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    const from = byteOffsetToUtf16(source, diagnostic.start)
    const end = byteOffsetToUtf16(source, diagnostic.end)
    const to = end === from && from < source.length ? from + 1 : end
    return {
      from,
      to: Math.max(from, to),
      severity: diagnostic.severity,
      message: diagnostic.message,
    }
  })
}
