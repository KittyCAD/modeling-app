import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { useEngineConnectionSubscriptions } from '@src/hooks/useEngineConnectionSubscriptions'
import type { Artifact } from '@src/lang/std/artifactGraph'

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

test('highlights the semantic sweep when hovering a region-backed body', () => {
  const pathCodeRef = {
    range: [0, 10, 0] as [number, number, number],
    pathToNode: [],
    nodePath: { steps: [] },
  }
  const sweepCodeRef = {
    range: [11, 20, 0] as [number, number, number],
    pathToNode: [],
    nodePath: { steps: [] },
  }
  const path: Artifact = {
    type: 'path',
    subType: 'region',
    id: 'path-1',
    codeRef: pathCodeRef,
    planeId: 'plane-1',
    segIds: [],
    sweepId: 'sweep-1',
    trajectorySweepId: null,
    consumed: true,
  }
  const sweep: Artifact = {
    type: 'sweep',
    id: 'sweep-1',
    codeRef: sweepCodeRef,
    pathId: path.id,
    subType: 'extrusion',
    surfaceIds: [],
    edgeIds: [],
    method: 'merge',
    trajectoryId: null,
    consumed: false,
  }
  const artifactGraph = new Map<string, Artifact>([
    [path.id, path],
    [sweep.id, sweep],
  ])
  const unsubscribe = vi.fn()
  let hoverCallback:
    | ((event: { data: { entity_id?: string } }) => void)
    | undefined
  const engineCommandManager = {
    subscribeTo: vi.fn(() => unsubscribe),
    subscribeToUnreliable: vi.fn(
      (subscription: {
        event: string
        callback: (event: { data: { entity_id?: string } }) => void
      }) => {
        if (subscription.event === 'highlight_set_entity') {
          hoverCallback = subscription.callback
        }
        return unsubscribe
      }
    ),
  }
  const setHighlightRange = vi.fn()

  useModelingContext.mockReturnValue({
    send: vi.fn(),
    state: { matches: () => false },
    context: {
      engineCommandManager,
      kclManager: {
        artifactGraph,
        highlightRange: null,
        setHighlightRange,
      },
      rustContext: {
        planesCreated: { add: vi.fn(() => unsubscribe) },
      },
      wasmInstance: {},
      store: {},
    },
  })

  const { unmount } = renderHook(() => useEngineConnectionSubscriptions())
  expect(hoverCallback).toBeDefined()

  act(() => {
    hoverCallback?.({ data: { entity_id: path.id } })
  })

  expect(setHighlightRange).toHaveBeenCalledWith([sweepCodeRef.range])
  unmount()
})
