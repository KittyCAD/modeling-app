import { describe, expect, it } from 'vitest'
import type { CompilationIssue } from '@rust/kcl-lib/bindings/CompilationIssue'
import type { ExecOutcome } from '@rust/kcl-lib/bindings/ExecOutcome'
import { blockingIssues, issueMessage } from '@src/lib/sketch/solveIssues'

const issue = (
  message: string,
  overrides: Partial<CompilationIssue> = {}
): CompilationIssue =>
  ({
    sourceRange: [0, 10, 0],
    message,
    suggestion: null,
    severity: 'Error',
    tag: 'None',
    ...overrides,
  }) as CompilationIssue

const outcomeOf = (
  issues: CompilationIssue[],
  refactorMetadata: unknown[] = []
) => ({ issues, refactorMetadata }) as unknown as ExecOutcome

describe('what a solve reported', () => {
  it('has nothing to say about an outcome that worked', () => {
    expect(blockingIssues(outcomeOf([]))).toEqual([])
    expect(issueMessage([])).toBeNull()
  })

  it('has nothing to say when there is no outcome at all', () => {
    expect(blockingIssues(null)).toEqual([])
  })

  it('reports what stopped the solve', () => {
    const found = blockingIssues(outcomeOf([issue('Constraints conflict')]))

    expect(issueMessage(found)).toBe('Constraints conflict')
  })

  /*
   * `angle()`'s deprecation has its own actionable lint and is reported on files
   * that are otherwise fine, so treating it as blocking would make every drag in
   * an older sketch look like a failure.
   */
  it('does not count the legacy angle deprecation against a solve', () => {
    const outcome = outcomeOf(
      [
        issue('angle() is deprecated', {
          tag: 'Deprecated',
          sourceRange: [4, 9, 0],
        }),
      ],
      [{ kind: 'legacyAngle', data: { sourceRange: [4, 9, 0] } }]
    )

    expect(blockingIssues(outcome)).toEqual([])
  })

  it('still counts a deprecation that is about something else', () => {
    const outcome = outcomeOf(
      [
        issue('something else is deprecated', {
          tag: 'Deprecated',
          sourceRange: [40, 90, 0],
        }),
      ],
      [{ kind: 'legacyAngle', data: { sourceRange: [4, 9, 0] } }]
    )

    expect(blockingIssues(outcome)).toHaveLength(1)
  })

  it('leads with a real error rather than with a warning', () => {
    const found = blockingIssues(
      outcomeOf([
        issue('just so you know', { severity: 'Warning' }),
        issue('this is what broke'),
      ])
    )

    expect(issueMessage(found)).toBe('this is what broke')
  })

  it('falls back to the first warning when they are all warnings', () => {
    const found = blockingIssues(
      outcomeOf([issue('only a warning', { severity: 'Warning' })])
    )

    expect(issueMessage(found)).toBe('only a warning')
  })
})
