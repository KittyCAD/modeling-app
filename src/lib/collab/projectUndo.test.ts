import { describe, expect, it } from 'vitest'
import type {
  ProjectAction,
  ProjectActionHistory,
} from '@src/contracts/projectHistory'
import { projectActionToUndo } from '@src/lib/collab/projectUndo'

const action: ProjectAction = {
  id: 'op-1',
  label: 'Extruded profile001',
  at: 0,
  author: null,
  paths: ['main.kcl'],
}

/** Records what it was asked, so the arguments can be asserted too. */
function stubHistory() {
  const asked: { path: string; depth: number }[] = []
  const history = {
    undoTargetFor(path: string, depth: number) {
      asked.push({ path, depth })
      return path === 'main.kcl' && depth === 1 ? action : null
    },
  } as unknown as ProjectActionHistory
  return { history, asked }
}

describe('projectActionToUndo', () => {
  it('returns the action the history names', () => {
    const { history, asked } = stubHistory()

    expect(
      projectActionToUndo({ history, path: 'main.kcl', undoDepth: 1 })
    ).toBe(action)
    expect(asked).toEqual([{ path: 'main.kcl', depth: 1 }])
  })

  it('returns nothing when the history declines', () => {
    const { history } = stubHistory()

    expect(
      projectActionToUndo({ history, path: 'main.kcl', undoDepth: 2 })
    ).toBeNull()
  })

  /** A build with no project history: undo is exactly what it always was. */
  it('returns nothing without a history, and does not ask', () => {
    expect(
      projectActionToUndo({ history: null, path: 'main.kcl', undoDepth: 1 })
    ).toBeNull()
  })

  /** A scratch buffer has no project-relative name to look an action up by. */
  it('returns nothing for a buffer with no path', () => {
    const { history, asked } = stubHistory()

    expect(
      projectActionToUndo({ history, path: null, undoDepth: 1 })
    ).toBeNull()
    expect(asked).toEqual([])
  })
})
