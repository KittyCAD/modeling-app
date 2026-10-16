import { act, renderHook, waitFor } from '@testing-library/react'
import { assert, beforeEach, expect, test, vi } from 'vitest'

import { useEngineConnectionSubscriptions } from '@src/hooks/useEngineConnectionSubscriptions'

const useModelingContext = vi.hoisted(() => vi.fn())
const getEventForQueryEntityTypeWithPoint = vi.hoisted(() => vi.fn())
const normalizeEntityReference = vi.hoisted(() => vi.fn())
const selectSketchPlane = vi.hoisted(() => vi.fn())

vi.mock('@src/hooks/useModelingContext', () => ({ useModelingContext }))
vi.mock('@src/lib/selections', () => ({
  engineTopologyFallbackFromReference: vi.fn(() => null),
  getEventForQueryEntityTypeWithPoint,
  normalizeEntityReference,
  showSketchOnImportForFace: vi.fn(() => false),
}))
vi.mock('@src/lib/selectSketchPlane', () => ({ selectSketchPlane }))

beforeEach(() => {
  vi.resetAllMocks()
  normalizeEntityReference.mockImplementation((reference) => reference)
})

type QueryWithPointEvent = {
  type: 'query_entity_type_with_point'
  data: { entity_id?: string; reference: unknown }
}

const edgeClick = (entityId: string): QueryWithPointEvent => ({
  type: 'query_entity_type_with_point',
  data: { entity_id: entityId, reference: { type: 'edge', side_faces: [] } },
})

function setupSelectionHook(initialMode = 'idle') {
  let mode = initialMode
  const unsubscribe = vi.fn()
  let queryWithPointCallback: ((event: QueryWithPointEvent) => void) | undefined
  const subscribeTo = vi.fn(
    (subscription: {
      event: string
      callback: (event: QueryWithPointEvent) => void
    }) => {
      expect(subscription.event).toBe('query_entity_type_with_point')
      queryWithPointCallback = subscription.callback
      return unsubscribe
    }
  )
  const engineCommandManager = {
    subscribeTo,
    subscribeToUnreliable: vi.fn(() => unsubscribe),
  }
  const kclManager = {
    isShiftDown: false,
    artifactGraph: new Map(),
    astSignal: { value: {} },
  }
  const rustContext = {
    planesCreated: { add: vi.fn(() => unsubscribe) },
  }
  const send = vi.fn()

  useModelingContext.mockReturnValue({
    send,
    state: { matches: (state: string) => mode === state },
    context: {
      engineCommandManager,
      kclManager,
      rustContext,
      wasmInstance: {},
      store: { useSketchSolveMode: { current: true } },
    },
  })
  const hook = renderHook(() => useEngineConnectionSubscriptions())
  const callback = queryWithPointCallback
  assert(callback, 'Missing query_entity_type_with_point subscription')
  return {
    ...hook,
    callback,
    send,
    kclManager,
    setMode: (nextMode: string) => {
      mode = nextMode
    },
  }
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
  getEventForQueryEntityTypeWithPoint.mockResolvedValue(selectionEvent)
  const { unmount, callback, send, kclManager } =
    setupSelectionHook('Sketch no face')
  act(() => {
    callback({
      type: 'query_entity_type_with_point',
      data: { reference: { type: 'face', face_id: 'face-id' } },
    })
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

test('applies delayed primitive and mapped clicks in arrival order with their original Shift state', async () => {
  const topologyEvent = {
    type: 'Set selection',
    data: {
      selectionType: 'enginePrimitiveSelection',
      selection: {
        type: 'enginePrimitive',
        entityId: 'primitive',
        parentEntityId: 'body',
        primitiveType: 'edge',
        primitiveIndex: 0,
      },
    },
  }
  const graphEvent = {
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selection: {
        entityRef: { type: 'edge', side_faces: ['face1', 'face2'] },
        engineEntityId: 'mapped',
      },
    },
  }
  let resolveTopology: ((event: typeof topologyEvent) => void) | undefined
  getEventForQueryEntityTypeWithPoint
    .mockImplementationOnce(
      () =>
        new Promise<typeof topologyEvent>((resolve) => {
          resolveTopology = resolve
        })
    )
    .mockResolvedValueOnce(graphEvent)
  const { callback, send, kclManager, unmount } = setupSelectionHook()
  act(() => {
    callback(edgeClick('primitive'))
    kclManager.isShiftDown = true
    callback(edgeClick('mapped'))
    kclManager.isShiftDown = false
  })
  await waitFor(() =>
    expect(getEventForQueryEntityTypeWithPoint).toHaveBeenCalledTimes(1)
  )
  expect(send).not.toHaveBeenCalled()
  await act(async () => resolveTopology?.(topologyEvent))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(send.mock.calls).toEqual([
    [{ ...topologyEvent, data: { ...topologyEvent.data, isShiftDown: false } }],
    [{ ...graphEvent, data: { ...graphEvent.data, isShiftDown: true } }],
  ])
  unmount()
})

test.each(['unmount', 'sketchSolveMode', 'Sketch no face'])(
  'drops pending and queued clicks after %s',
  async (nextMode) => {
    const event = {
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor', selection: {} },
    }
    let resolveSelection: ((selectionEvent: typeof event) => void) | undefined
    getEventForQueryEntityTypeWithPoint.mockImplementationOnce(
      () =>
        new Promise<typeof event>((resolve) => {
          resolveSelection = resolve
        })
    )
    const { callback, send, unmount, setMode } = setupSelectionHook()
    act(() => {
      callback(edgeClick('first'))
      callback(edgeClick('second'))
    })
    await waitFor(() =>
      expect(getEventForQueryEntityTypeWithPoint).toHaveBeenCalledTimes(1)
    )
    if (nextMode === 'unmount') unmount()
    else setMode(nextMode)
    await act(async () => resolveSelection?.(event))
    expect(send).not.toHaveBeenCalled()
    expect(selectSketchPlane).not.toHaveBeenCalled()
    expect(getEventForQueryEntityTypeWithPoint).toHaveBeenCalledTimes(1)
    if (nextMode !== 'unmount') unmount()
  }
)
