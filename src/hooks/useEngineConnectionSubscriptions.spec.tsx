import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { useEngineConnectionSubscriptions } from '@src/hooks/useEngineConnectionSubscriptions'

const useModelingContext = vi.hoisted(() => vi.fn())
const getEventForSelectWithPoint = vi.hoisted(() => vi.fn())
const selectSketchPlane = vi.hoisted(() => vi.fn())

vi.mock('@src/hooks/useModelingContext', () => ({ useModelingContext }))
vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    userFeatures: {
      useHas: () => false,
    },
  }),
}))
vi.mock('@src/lib/selections', () => ({
  getEventForSelectWithPoint,
  selectSketchPlane,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

test('stores a post-selected primitive before starting a sketch', async () => {
  const selectionEvent = {
    type: 'Set selection',
    data: {
      selectionType: 'enginePrimitiveSelection',
      selection: {
        type: 'enginePrimitive',
        entityId: 'face-id',
        parentEntityId: 'solid-id',
        primitiveIndex: 4,
        primitiveType: 'face',
      },
    },
  }
  const engineEvent = {
    type: 'select_with_point',
    data: {
      entity_id: 'face-id',
    },
  }
  const unsubscribe = vi.fn()
  let selectWithPointCallback: ((event: typeof engineEvent) => void) | undefined
  const subscribeTo = vi.fn(
    (subscription: { callback: (event: typeof engineEvent) => void }) => {
      selectWithPointCallback = subscription.callback
      return unsubscribe
    }
  )
  const engineCommandManager = {
    subscribeTo,
    subscribeToUnreliable: vi.fn(() => unsubscribe),
  }
  const kclManager = {}
  const rustContext = {
    planesCreated: {
      add: vi.fn(() => unsubscribe),
    },
  }
  const send = vi.fn()

  useModelingContext.mockReturnValue({
    send,
    state: {
      matches: (state: string) => state === 'Sketch no face',
    },
    context: {
      engineCommandManager,
      kclManager,
      rustContext,
      wasmInstance: {},
      store: {
        useSketchSolveMode: {
          current: true,
        },
      },
    },
  })
  getEventForSelectWithPoint.mockResolvedValue(selectionEvent)
  selectSketchPlane.mockResolvedValue(undefined)

  const { unmount } = renderHook(() => useEngineConnectionSubscriptions())
  const callback = selectWithPointCallback
  expect(callback).toBeDefined()
  if (!callback) return

  act(() => {
    callback(engineEvent)
  })

  await waitFor(() => {
    expect(send).toHaveBeenCalledWith(selectionEvent)
    expect(selectSketchPlane).toHaveBeenCalledWith('face-id', true, kclManager)
  })
  expect(send.mock.invocationCallOrder[0]).toBeLessThan(
    selectSketchPlane.mock.invocationCallOrder[0]
  )

  unmount()
})
