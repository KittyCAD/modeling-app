import { act, renderHook, waitFor } from '@testing-library/react'
import { assert, beforeEach, expect, test, vi } from 'vitest'

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

type SelectWithPointEvent = {
  type: 'select_with_point'
  data: { entity_id: string }
}

function setupSelectionHook(selectingSketchPlane = false) {
  const unsubscribe = vi.fn()
  let selectWithPointCallback:
    | ((event: SelectWithPointEvent) => void)
    | undefined
  const subscribeTo = vi.fn(
    (subscription: { callback: (event: SelectWithPointEvent) => void }) => {
      selectWithPointCallback = subscription.callback
      return unsubscribe
    }
  )
  const engineCommandManager = {
    subscribeTo,
    subscribeToUnreliable: vi.fn(() => unsubscribe),
  }
  const kclManager = { isShiftDown: false }
  const rustContext = {
    planesCreated: {
      add: vi.fn(() => unsubscribe),
    },
  }
  const send = vi.fn()

  useModelingContext.mockReturnValue({
    send,
    state: {
      matches: (state: string) =>
        selectingSketchPlane && state === 'Sketch no face',
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
  const hook = renderHook(() => useEngineConnectionSubscriptions())
  const callback = selectWithPointCallback
  assert(callback, 'Missing select_with_point subscription')
  return { ...hook, callback, send, kclManager }
}

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
  const engineEvent: SelectWithPointEvent = {
    type: 'select_with_point',
    data: {
      entity_id: 'face-id',
    },
  }
  getEventForSelectWithPoint.mockResolvedValue(selectionEvent)
  selectSketchPlane.mockResolvedValue(undefined)

  const { unmount, callback, send, kclManager } = setupSelectionHook(true)

  act(() => {
    callback(engineEvent)
  })

  await waitFor(() => {
    expect(send).toHaveBeenCalledWith({
      ...selectionEvent,
      data: { ...selectionEvent.data, isShiftDown: false },
    })
    expect(selectSketchPlane).toHaveBeenCalledWith('face-id', true, kclManager)
  })
  expect(send.mock.invocationCallOrder[0]).toBeLessThan(
    selectSketchPlane.mock.invocationCallOrder[0]
  )

  unmount()
})

test('applies delayed primitive and mapped clicks in arrival order with their original Shift state', async () => {
  const primitiveEvent = {
    type: 'Set selection',
    data: {
      selectionType: 'enginePrimitiveSelection',
      selection: { entityId: 'primitive' },
    },
  }
  const graphEvent = {
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selection: { engineEntityId: 'mapped' },
    },
  }
  let resolvePrimitive: ((event: typeof primitiveEvent) => void) | undefined
  getEventForSelectWithPoint
    .mockImplementationOnce(
      () =>
        new Promise<typeof primitiveEvent>((resolve) => {
          resolvePrimitive = resolve
        })
    )
    .mockResolvedValueOnce(graphEvent)
  const { callback, send, kclManager, unmount } = setupSelectionHook()
  act(() => {
    callback({ type: 'select_with_point', data: { entity_id: 'primitive' } })
    kclManager.isShiftDown = true
    callback({ type: 'select_with_point', data: { entity_id: 'mapped' } })
    kclManager.isShiftDown = false
  })
  await waitFor(() =>
    expect(getEventForSelectWithPoint).toHaveBeenCalledTimes(1)
  )
  expect(send).not.toHaveBeenCalled()
  await act(async () => resolvePrimitive?.(primitiveEvent))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(send.mock.calls).toEqual([
    [
      {
        ...primitiveEvent,
        data: { ...primitiveEvent.data, isShiftDown: false },
      },
    ],
    [{ ...graphEvent, data: { ...graphEvent.data, isShiftDown: true } }],
  ])
  unmount()
})

test('drops pending and queued viewport clicks when the subscription is torn down', async () => {
  const event = {
    type: 'Set selection',
    data: { selectionType: 'singleCodeCursor' },
  }
  let resolveSelection: ((selectionEvent: typeof event) => void) | undefined
  getEventForSelectWithPoint.mockImplementationOnce(
    () =>
      new Promise<typeof event>((resolve) => {
        resolveSelection = resolve
      })
  )
  const { callback, send, unmount } = setupSelectionHook()
  act(() => {
    callback({ type: 'select_with_point', data: { entity_id: 'first' } })
    callback({ type: 'select_with_point', data: { entity_id: 'second' } })
  })
  await waitFor(() =>
    expect(getEventForSelectWithPoint).toHaveBeenCalledTimes(1)
  )
  unmount()
  await act(async () => resolveSelection?.(event))
  expect(send).not.toHaveBeenCalled()
  expect(getEventForSelectWithPoint).toHaveBeenCalledTimes(1)
})
