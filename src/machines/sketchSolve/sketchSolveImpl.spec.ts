import { expect, describe, test, vi } from 'vitest'
import {
  sendToActorIfActive,
  updateSelectedIds,
} from '@src/machines/sketchSolve/sketchSolveImpl'

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

describe('sendToActorIfActive', () => {
  test('sends when the actor is active', () => {
    const send = vi.fn()
    const actor = {
      getSnapshot: () => ({ status: 'active' as const }),
      send,
    }

    const didSend = sendToActorIfActive(actor as any, { type: 'ping' })

    expect(didSend).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'ping' })
  })

  test('does not send when the actor has stopped', () => {
    const send = vi.fn()
    const actor = {
      getSnapshot: () => ({ status: 'stopped' as const }),
      send,
    }

    const didSend = sendToActorIfActive(actor as any, { type: 'ping' })

    expect(didSend).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
