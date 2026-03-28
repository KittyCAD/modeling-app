import { expect, describe, test } from 'vitest'
import { updateSelectedIds } from '@src/machines/sketchSolve/sketchSolveImpl'

// This has to be an integration test because sketchSolveImpl has a dependency tracing back to WASM,
// even though this function doesn't directly use it.
describe('updateSelectedIds', () => {
  test('replaces the existing selection when requested', () => {
    const result = updateSelectedIds({
      context: {
        selectedIds: [3, 4, 10],
        duringAreaSelectIds: [],
      },
      event: {
        type: 'update selected ids',
        data: {
          selectedIds: [10],
          replaceExistingSelection: true,
        },
      },
    } as any)

    expect(result.selectedIds).toEqual([10])
  })
})
