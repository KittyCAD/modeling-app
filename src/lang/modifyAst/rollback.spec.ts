import { describe, expect, it } from 'vitest'
import {
  findTopLevelRollbackExit,
  insertRollbackExitAfterRange,
  insertRollbackExitBeforeRange,
  moveRollbackExitAfterRange,
  removeRollbackExit,
} from '@src/lang/modifyAst/rollback'

describe('rollback marker codemods', () => {
  it('inserts, moves, and removes a top-level rollback exit', () => {
    const code = `a = 1\nb = 2\nc = 3\n`
    const withMarker = insertRollbackExitAfterRange(code, [0, 5, 0])
    expect(withMarker).toBe(`a = 1\nexit()\nb = 2\nc = 3\n`)
    expect(findTopLevelRollbackExit(withMarker)?.range[0]).toBeGreaterThan(0)

    const moved = moveRollbackExitAfterRange(withMarker, [6, 11, 0])
    expect(moved).toBe(`a = 1\nb = 2\nexit()\nc = 3\n`)

    expect(removeRollbackExit(moved)).toBe(code)
  })

  it('inserts a top-level rollback exit before a target range', () => {
    const code = `@settings(experimentalFeatures = allow)\na = 1\nb = 2\n`

    expect(insertRollbackExitBeforeRange(code, [40, 45, 0])).toBe(
      `@settings(experimentalFeatures = allow)\nexit()\na = 1\nb = 2\n`
    )
  })

  it('ignores nested exit calls', () => {
    const code = `fn foo() {\n  exit()\n}\na = 1\n`
    expect(findTopLevelRollbackExit(code)).toBeUndefined()
  })
})
