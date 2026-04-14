import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

import type { SourceDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import { machine } from '@src/machines/sketchSolve/tools/pointTool'
import {
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import {
  clearToolSnappingState,
  getBestSnappingCandidate,
  sendHoveredSnappingCandidate,
  updateToolSnappingPreview,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'

vi.mock('@src/machines/sketchSolve/tools/toolSnappingUtils', () => ({
  clearToolSnappingState: vi.fn(),
  getBestSnappingCandidate: vi.fn(() => null),
  sendHoveredSnappingCandidate: vi.fn(),
  updateToolSnappingPreview: vi.fn(),
}))

function createTestActor() {
  const sceneInfra = createMockSceneInfra()
  const setCallbacksMock = vi.fn()
  sceneInfra.setCallbacks = setCallbacksMock
  const rustContext = createMockRustContext()
  const kclManager = createMockKclManager()

  const actor = createActor(machine, {
    input: {
      sceneInfra,
      rustContext,
      kclManager,
      sketchId: 7,
    },
  }).start()

  return {
    actor,
    sceneInfra,
    rustContext,
    setCallbacksMock,
  }
}

describe('pointTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getBestSnappingCandidate).mockReturnValue(null)
  })

  it.each([
    {
      label: 'other points',
      candidate: {
        position: [10, 20] as [number, number],
        target: { type: 'point' as const, id: 99 },
      },
      expectedConstraint: {
        type: 'Coincident' as const,
        segments: [1, 99],
      },
    },
    {
      label: 'segments',
      candidate: {
        position: [30, 40] as [number, number],
        target: { type: 'line' as const, id: 88 },
      },
      expectedConstraint: {
        type: 'Coincident' as const,
        segments: [1, 88],
      },
    },
    {
      label: 'the origin',
      candidate: {
        position: [0, 0] as [number, number],
        target: { type: 'origin' as const },
      },
      expectedConstraint: {
        type: 'Coincident' as const,
        segments: [1, 'ORIGIN'],
      },
    },
    {
      label: 'the x axis',
      candidate: {
        position: [10, 0] as [number, number],
        target: { type: 'x-axis' as const },
      },
      expectedConstraint: {
        type: 'VerticalDistance' as const,
        points: [1, 'ORIGIN'],
        distance: { value: 0, units: 'Mm' },
        source: { expr: '0mm', is_literal: true },
      },
    },
    {
      label: 'the y axis',
      candidate: {
        position: [0, 20] as [number, number],
        target: { type: 'y-axis' as const },
      },
      expectedConstraint: {
        type: 'HorizontalDistance' as const,
        points: [1, 'ORIGIN'],
        distance: { value: 0, units: 'Mm' },
        source: { expr: '0mm', is_literal: true },
      },
    },
  ])(
    'commits snapping to $label',
    async ({ candidate, expectedConstraint }) => {
      vi.mocked(getBestSnappingCandidate).mockReturnValue({
        ...candidate,
        distance: 0,
      })

      const { rustContext, setCallbacksMock } = createTestActor()
      const point = createPointApiObject({
        id: 1,
        x: candidate.position[0],
        y: candidate.position[1],
      })

      vi.mocked(rustContext.addSegment).mockResolvedValue({
        kclSource: { text: 'point' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta([point], [1]),
        checkpointId: null,
      } as Awaited<ReturnType<typeof rustContext.addSegment>>)
      vi.mocked(rustContext.addConstraint).mockResolvedValue({
        kclSource: { text: 'snap' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta([], [10]),
        checkpointId: null,
      } as Awaited<ReturnType<typeof rustContext.addConstraint>>)

      const callbacks = setCallbacksMock.mock.calls.at(-1)?.[0]
      callbacks?.onClick?.({
        mouseEvent: { which: 1 },
        intersectionPoint: { twoD: { x: 1, y: 2 } },
      })

      await vi.waitFor(() => {
        expect(rustContext.addSegment).toHaveBeenCalledTimes(1)
        expect(rustContext.addConstraint).toHaveBeenCalledTimes(1)
      })

      expect(rustContext.addSegment).toHaveBeenCalledWith(
        0,
        7,
        {
          type: 'Point',
          position: {
            x: { type: 'Var', value: candidate.position[0], units: 'Mm' },
            y: { type: 'Var', value: candidate.position[1], units: 'Mm' },
          },
        },
        'point-tool-point',
        expect.anything()
      )
      expect(rustContext.addConstraint).toHaveBeenCalledWith(
        0,
        7,
        expectedConstraint,
        expect.anything()
      )
    }
  )

  it('updates hover snapping preview using the snapping candidate', () => {
    const candidate = {
      position: [10, 20] as [number, number],
      target: { type: 'line' as const, id: 88 },
      distance: 0,
    }
    vi.mocked(getBestSnappingCandidate).mockReturnValue(candidate)

    const { setCallbacksMock } = createTestActor()
    const callbacks = setCallbacksMock.mock.calls.at(-1)?.[0]

    callbacks?.onMove?.({
      mouseEvent: { which: 1 },
      intersectionPoint: { twoD: { x: 1, y: 2 } },
    })

    expect(sendHoveredSnappingCandidate).toHaveBeenCalledWith(
      expect.anything(),
      candidate
    )
    expect(updateToolSnappingPreview).toHaveBeenCalledWith({
      sceneInfra: expect.anything(),
      target: candidate,
    })
  })

  it('updates hover snapping preview using axis candidates', () => {
    const candidate = {
      position: [10, 0] as [number, number],
      target: { type: 'x-axis' as const },
      distance: 0,
    }
    vi.mocked(getBestSnappingCandidate).mockReturnValue(candidate)

    const { setCallbacksMock } = createTestActor()
    const callbacks = setCallbacksMock.mock.calls.at(-1)?.[0]

    callbacks?.onMove?.({
      mouseEvent: { which: 1 },
      intersectionPoint: { twoD: { x: 1, y: 2 } },
    })

    expect(sendHoveredSnappingCandidate).toHaveBeenCalledWith(
      expect.anything(),
      candidate
    )
    expect(updateToolSnappingPreview).toHaveBeenCalledWith({
      sceneInfra: expect.anything(),
      target: candidate,
    })
  })

  it('clears snapping state when the pointer leaves sketch geometry', () => {
    const { actor, setCallbacksMock } = createTestActor()
    const callbacks = setCallbacksMock.mock.calls.at(-1)?.[0]

    callbacks?.onMove?.({
      mouseEvent: { which: 1 },
      intersectionPoint: undefined,
    })

    expect(clearToolSnappingState).toHaveBeenCalledWith({
      self: actor,
      sceneInfra: expect.anything(),
    })
  })
})
