import type { CompilationIssue } from '@rust/kcl-lib/bindings/CompilationIssue'
import type { ExecOutcome } from '@rust/kcl-lib/bindings/ExecOutcome'

/**
 * Whether a solve produced something worth showing.
 *
 * A port of `sketchSolveErrors.ts`. Every mutation answers with an execution
 * outcome, and a solve that could not satisfy the constraints reports it there
 * rather than by rejecting — so a caller that only catches rejections believes a
 * refused drag succeeded and draws whatever came back.
 *
 * That matters twice over for dragging: the drag vector is measured from the
 * last *good* position, so accepting a bad solve as good would leave the pointer
 * and the geometry permanently offset by however far the refused move was.
 */

/**
 * The issues that mean a solve did not work.
 *
 * `angle()`'s deprecation is excluded, exactly as the existing app excludes it:
 * it has its own actionable lint, it is reported on files that are otherwise
 * fine, and treating it as blocking would make every drag in an older sketch
 * look like a failure.
 */
export function blockingIssues(
  outcome: ExecOutcome | null | undefined
): readonly CompilationIssue[] {
  if (!outcome) return []

  const legacyAngleRanges = (outcome.refactorMetadata ?? [])
    .filter((metadata) => metadata.kind === 'legacyAngle')
    .map((metadata) => metadata.data.sourceRange)

  return (outcome.issues ?? []).filter((issue) => {
    if (issue.tag !== 'Deprecated') return true

    return !legacyAngleRanges.some(
      (range) =>
        range[0] === issue.sourceRange[0] &&
        range[1] === issue.sourceRange[1] &&
        range[2] === issue.sourceRange[2]
    )
  })
}

/**
 * What to say about them, or null when there is nothing to say.
 *
 * The first real error, or the first issue of any kind if they are all warnings:
 * a list of everything would be a wall of text over the drawing, and the first
 * is the one that stopped the solve.
 */
export function issueMessage(
  issues: readonly CompilationIssue[]
): string | null {
  if (issues.length === 0) return null

  const first =
    issues.find((issue) => issue.severity !== 'Warning') ?? issues[0]
  return first?.message ?? null
}
