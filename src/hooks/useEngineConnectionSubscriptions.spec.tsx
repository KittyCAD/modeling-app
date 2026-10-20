import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { useEngineConnectionSubscriptions } from '@src/hooks/useEngineConnectionSubscriptions'

const useModelingContext = vi.hoisted(() => vi.fn())
const getEventForQueryEntityTypeWithPoint = vi.hoisted(() => vi.fn())
const normalizeEntityReference = vi.hoisted(() => vi.fn())
const selectSketchPlane = vi.hoisted(() => vi.fn())
const getCodeRefsFromEntityReference = vi.hoisted(() => vi.fn())

vi.mock('@src/hooks/useModelingContext', () => ({ useModelingContext }))
vi.mock('@src/lib/selections', () => ({
  engineTopologyFallbackFromReference: vi.fn(() => null),
  getEventForQueryEntityTypeWithPoint,
  getCodeRefsFromEntityReference,
  normalizeEntityReference,
  showSketchOnImportForFace: vi.fn(() => false),
}))
vi.mock('@src/lib/selectSketchPlane', () => ({ selectSketchPlane }))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => vi.useRealTimers())

function mountHover() {
  let hover: ((event: { data: { entity_id: string } }) => void) | undefined
  const unsubscribe = vi.fn()
  const sendSceneCommand = vi.fn().mockResolvedValue(null)
  const setHighlightRange = vi.fn()
  useModelingContext.mockReturnValue({
    send: vi.fn(),
    state: { matches: () => false },
    context: {
      engineCommandManager: {
        sendSceneCommand,
        subscribeTo: vi.fn(() => unsubscribe),
        subscribeToUnreliable: vi.fn(
          (subscription: { callback: NonNullable<typeof hover> }) => {
            hover = subscription.callback
            return unsubscribe
          }
        ),
      },
      kclManager: { setHighlightRange, artifactGraph: new Map() },
      rustContext: { planesCreated: { add: vi.fn(() => unsubscribe) } },
      wasmInstance: {},
      store: {},
    },
  })
  const hook = renderHook(() => useEngineConnectionSubscriptions())
  return {
    ...hook,
    sendSceneCommand,
    setHighlightRange,
    highlight: (entity_id: string) => {
      act(() => hover?.({ data: { entity_id } }))
    },
  }
}

test('resolves only the latest rapid hover on the next frame without a debounce', async () => {
  vi.useFakeTimers()
  const { highlight, sendSceneCommand, unmount } = mountHover()
  highlight('face-a')
  highlight('face-b')
  await act(async () => vi.advanceTimersToNextFrame())

  expect(sendSceneCommand).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      cmd: { type: 'query_entity_type', entity_id: 'face-b' },
    })
  )
  unmount()
})

test('does not apply a hover query response after the subscription unmounts', async () => {
  vi.useFakeTimers()
  const { highlight, sendSceneCommand, setHighlightRange, unmount } =
    mountHover()
  const response = Promise.withResolvers<null>()
  sendSceneCommand.mockReturnValueOnce(response.promise)
  highlight('face-a')
  await act(async () => vi.advanceTimersByTimeAsync(300))
  expect(sendSceneCommand).toHaveBeenCalledOnce()
  unmount()
  await act(async () => response.resolve(null))

  expect(setHighlightRange).not.toHaveBeenCalled()
})

test('cancels the queued hover query when the cursor leaves the entity', async () => {
  vi.useFakeTimers()
  const { highlight, sendSceneCommand, unmount } = mountHover()
  highlight('face-a')
  highlight('')
  await act(async () => vi.advanceTimersToNextFrame())

  expect(sendSceneCommand).not.toHaveBeenCalled()
  unmount()
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
    type: 'query_entity_type_with_point',
    data: {
      reference: {
        type: 'face',
        face_id: 'face-id',
      },
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
      store: {},
    },
  })
  getEventForQueryEntityTypeWithPoint.mockResolvedValue(selectionEvent)
  normalizeEntityReference.mockReturnValue(engineEvent.data.reference)
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
    expect(selectSketchPlane).toHaveBeenCalledWith('face-id', kclManager)
  })
  expect(send.mock.invocationCallOrder[0]).toBeLessThan(
    selectSketchPlane.mock.invocationCallOrder[0]
  )

  unmount()
})
