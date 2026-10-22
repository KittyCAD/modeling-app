import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { useEngineConnectionSubscriptions } from '@src/hooks/useEngineConnectionSubscriptions'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import type { WebSocketResponse } from '@kittycad/lib'
import type * as Selections from '@src/lib/selections'

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
  normalizeEntityReference.mockReset()
  getCodeRefsFromEntityReference.mockReset()
})

afterEach(() => vi.useRealTimers())

function mountHover(artifactGraph: ArtifactGraph = new Map()) {
  let hover: ((event: { data: { entity_id: string } }) => void) | undefined
  const unsubscribe = vi.fn()
  const sendSceneCommand = vi.fn().mockResolvedValue(null)
  const setHighlightRange = vi.fn()
  const manager = {
    connection: {},
    sendSceneCommand,
    subscribeTo: vi.fn(() => unsubscribe),
    subscribeToUnreliable: vi.fn(
      (subscription: { callback: NonNullable<typeof hover> }) => {
        hover = subscription.callback
        return unsubscribe
      }
    ),
  }
  const kclManager = {
    setHighlightRange,
    artifactGraph,
    highlightRange: [[0, 0]],
  }
  useModelingContext.mockReturnValue({
    send: vi.fn(),
    state: { matches: () => false },
    context: {
      engineCommandManager: manager,
      kclManager,
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
    manager,
    kclManager,
    highlight: (entity_id: string) => {
      act(() => hover?.({ data: { entity_id } }))
    },
  }
}

function faceGraph(): ArtifactGraph {
  const codeRef = (range: SourceRange) => ({
    range,
    nodePath: { steps: [] },
    pathToNode: [],
  })
  return new Map<string, Artifact>([
    [
      'segment',
      {
        type: 'segment',
        id: 'segment',
        pathId: 'path',
        edgeIds: [],
        commonSurfaceIds: [],
        codeRef: codeRef([10, 20, 0]),
      },
    ],
    [
      'path',
      {
        type: 'path',
        id: 'path',
        subType: 'sketch',
        planeId: 'plane',
        segIds: ['segment'],
        consumed: false,
        trajectorySweepId: null,
        codeRef: codeRef([30, 40, 0]),
      },
    ],
    [
      'sweep',
      {
        type: 'sweep',
        id: 'sweep',
        subType: 'extrusion',
        pathId: 'path',
        surfaceIds: ['wall', 'cap'],
        edgeIds: [],
        trajectoryId: null,
        method: 'new',
        consumed: false,
        codeRef: codeRef([50, 60, 0]),
      },
    ],
    [
      'wall',
      {
        type: 'wall',
        id: 'wall',
        segId: 'segment',
        sweepId: 'sweep',
        pathIds: [],
        edgeCutEdgeIds: [],
        faceCodeRef: codeRef([0, 0, 0]),
        cmdId: 'wall-command',
      },
    ],
    [
      'cap',
      {
        type: 'cap',
        id: 'cap',
        subType: 'end',
        sweepId: 'sweep',
        pathIds: [],
        edgeCutEdgeIds: [],
        faceCodeRef: codeRef([0, 0, 0]),
        cmdId: 'cap-command',
      },
    ],
  ])
}

function edgeResponse(): WebSocketResponse {
  return {
    success: true,
    request_id: crypto.randomUUID(),
    resp: {
      type: 'modeling',
      data: {
        modeling_response: {
          type: 'query_entity_type',
          data: {
            reference: {
              type: 'edge',
              side_faces: ['wall'],
              end_faces: ['cap'],
            },
          },
        },
      },
    },
  }
}

test.each([
  {
    entity: 'wall',
    ranges: [
      [10, 20, 0],
      [50, 60, 0],
    ],
  },
  {
    entity: 'cap',
    ranges: [
      [30, 40, 0],
      [50, 60, 0],
    ],
  },
])(
  'resolves an acknowledged $entity face through the real artifact resolver without another engine query',
  async ({ entity, ranges }) => {
    const actual = await vi.importActual<typeof Selections>(
      '@src/lib/selections'
    )
    normalizeEntityReference.mockImplementation(actual.normalizeEntityReference)
    getCodeRefsFromEntityReference.mockImplementation(
      actual.getCodeRefsFromEntityReference
    )
    vi.useFakeTimers()
    const { highlight, sendSceneCommand, setHighlightRange, unmount } =
      mountHover(faceGraph())
    highlight(entity)
    await act(async () => vi.advanceTimersToNextFrame())
    expect(sendSceneCommand).not.toHaveBeenCalled()
    expect(setHighlightRange).toHaveBeenLastCalledWith(ranges)
    unmount()
  }
)

test('retries the current unknown entity after its query fails', async () => {
  vi.useFakeTimers()
  const { highlight, sendSceneCommand, unmount } = mountHover()
  sendSceneCommand.mockRejectedValueOnce(
    new Error('The query connection closed')
  )
  highlight('unknown-face')
  await act(async () => vi.advanceTimersToNextFrame())
  highlight('unknown-face')
  await act(async () => vi.advanceTimersToNextFrame())
  expect(sendSceneCommand).toHaveBeenCalledTimes(2)
  unmount()
})

test.each(['connection', 'graph'])(
  'does not let an old %s reply publish or clear the replacement owner query',
  async (owner) => {
    const actual = await vi.importActual<typeof Selections>(
      '@src/lib/selections'
    )
    normalizeEntityReference.mockImplementation(actual.normalizeEntityReference)
    getCodeRefsFromEntityReference.mockImplementation(
      actual.getCodeRefsFromEntityReference
    )
    vi.useFakeTimers()
    const {
      highlight,
      sendSceneCommand,
      manager,
      kclManager,
      setHighlightRange,
      unmount,
    } = mountHover(faceGraph())
    const oldReply = Promise.withResolvers<WebSocketResponse>()
    const currentReply = Promise.withResolvers<WebSocketResponse>()
    sendSceneCommand
      .mockReturnValueOnce(oldReply.promise)
      .mockReturnValueOnce(currentReply.promise)
    highlight('edge')
    await act(async () => vi.advanceTimersToNextFrame())
    if (owner === 'connection') manager.connection = {}
    else kclManager.artifactGraph = faceGraph()
    highlight('edge')
    await act(async () => vi.advanceTimersToNextFrame())
    expect(sendSceneCommand).toHaveBeenCalledTimes(2)
    await act(async () => oldReply.resolve(edgeResponse()))
    expect(setHighlightRange).not.toHaveBeenCalled()
    highlight('edge')
    await act(async () => vi.advanceTimersToNextFrame())
    expect(sendSceneCommand).toHaveBeenCalledTimes(2)
    await act(async () => currentReply.resolve(edgeResponse()))
    expect(setHighlightRange).toHaveBeenLastCalledWith([
      [10, 20, 0],
      [30, 40, 0],
    ])
    unmount()
  }
)

test.each(['edge', 'imported'])(
  'keeps the engine query for %s topology even when its artifact is known',
  async (entity) => {
    vi.useFakeTimers()
    const graph = faceGraph()
    graph.set('edge', {
      type: 'sweepEdge',
      id: 'edge',
      segId: 'segment',
      sweepId: 'sweep',
    })
    graph.set('imported', {
      type: 'importedGeometry',
      id: 'imported',
      consumed: false,
      codeRef: { range: [80, 90, 0], pathToNode: [], nodePath: { steps: [] } },
    })
    const { highlight, sendSceneCommand, unmount } = mountHover(graph)
    highlight(entity)
    await act(async () => vi.advanceTimersToNextFrame())
    expect(sendSceneCommand).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        cmd: { type: 'query_entity_type', entity_id: entity },
      })
    )
    unmount()
  }
)

test('re-resolves the same face against a replacement artifact graph', async () => {
  const actual = await vi.importActual<typeof Selections>('@src/lib/selections')
  normalizeEntityReference.mockImplementation(actual.normalizeEntityReference)
  getCodeRefsFromEntityReference.mockImplementation(
    actual.getCodeRefsFromEntityReference
  )
  vi.useFakeTimers()
  const { highlight, kclManager, setHighlightRange, unmount } = mountHover(
    faceGraph()
  )
  highlight('wall')
  await act(async () => vi.advanceTimersToNextFrame())
  const graph = faceGraph()
  const segment = graph.get('segment')
  if (!segment || segment.type !== 'segment')
    throw new Error('Missing source segment')
  segment.codeRef.range = [70, 80, 0]
  kclManager.artifactGraph = graph
  highlight('wall')
  await act(async () => vi.advanceTimersToNextFrame())
  expect(setHighlightRange).toHaveBeenLastCalledWith([
    [70, 80, 0],
    [50, 60, 0],
  ])
  unmount()
})

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
