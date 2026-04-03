import { describe, expect, it, vi } from 'vitest'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  CircleTool,
  LineTool,
  MockSketchMode,
  type CommitLineDraftResult,
  type CircleCommitResult,
  type GeneratorToolContext,
  type StartLineDraftResult,
} from '@src/machines/sketchSolve/tools/generatorToolScaffold'
import {
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function createMode(overrides?: {
  commitCircle?: NonNullable<GeneratorToolContext['commitCircle']>
  startLineDraft?: NonNullable<GeneratorToolContext['startLineDraft']>
  previewLineDraft?: NonNullable<GeneratorToolContext['previewLineDraft']>
  commitLineDraft?: NonNullable<GeneratorToolContext['commitLineDraft']>
  startChainedLineDraft?: NonNullable<
    GeneratorToolContext['startChainedLineDraft']
  >
  onSketchOutcome?: NonNullable<GeneratorToolContext['onSketchOutcome']>
  onRadiusPreview?: NonNullable<GeneratorToolContext['onRadiusPreview']>
  clearRadiusPreview?: NonNullable<GeneratorToolContext['clearRadiusPreview']>
  setDraftEntities?: NonNullable<GeneratorToolContext['setDraftEntities']>
  clearDraftEntities?: NonNullable<GeneratorToolContext['clearDraftEntities']>
  deleteDraftEntities?: NonNullable<GeneratorToolContext['deleteDraftEntities']>
}) {
  const sceneInfra = createMockSceneInfra()
  const rustContext = createMockRustContext()
  const kclManager = createMockKclManager()
  const commitCircle: NonNullable<GeneratorToolContext['commitCircle']> =
    overrides?.commitCircle ||
    (vi.fn(
      async (): Promise<CircleCommitResult> => ({
        kclSource: { text: 'circle' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta([], []) as SceneGraphDelta,
      })
    ) as NonNullable<GeneratorToolContext['commitCircle']>)
  const startLineDraft: NonNullable<GeneratorToolContext['startLineDraft']> =
    overrides?.startLineDraft ||
    (vi.fn(
      async (): Promise<StartLineDraftResult> => ({
        kclSource: { text: 'line draft' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta([], []) as SceneGraphDelta,
        draftPointId: 101,
        newlyAddedEntities: { segmentIds: [11, 12], constraintIds: [] },
      })
    ) as NonNullable<GeneratorToolContext['startLineDraft']>)
  const previewLineDraft: NonNullable<
    GeneratorToolContext['previewLineDraft']
  > =
    overrides?.previewLineDraft ||
    (vi.fn(
      async (): Promise<CircleCommitResult> => ({
        kclSource: { text: 'line preview' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta([], []) as SceneGraphDelta,
      })
    ) as NonNullable<GeneratorToolContext['previewLineDraft']>)
  const commitLineDraft: NonNullable<GeneratorToolContext['commitLineDraft']> =
    overrides?.commitLineDraft ||
    (vi.fn(
      async (): Promise<CommitLineDraftResult> => ({
        kclSource: { text: 'line commit' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta([], []) as SceneGraphDelta,
      })
    ) as NonNullable<GeneratorToolContext['commitLineDraft']>)
  const startChainedLineDraft: NonNullable<
    GeneratorToolContext['startChainedLineDraft']
  > =
    overrides?.startChainedLineDraft ||
    (vi.fn(
      async (): Promise<StartLineDraftResult> => ({
        kclSource: { text: 'line chain start' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta([], []) as SceneGraphDelta,
        draftPointId: 202,
        newlyAddedEntities: { segmentIds: [21], constraintIds: [31] },
      })
    ) as NonNullable<GeneratorToolContext['startChainedLineDraft']>)
  const onSketchOutcome: NonNullable<GeneratorToolContext['onSketchOutcome']> =
    overrides?.onSketchOutcome ||
    (vi.fn() as NonNullable<GeneratorToolContext['onSketchOutcome']>)
  const onRadiusPreview: NonNullable<GeneratorToolContext['onRadiusPreview']> =
    overrides?.onRadiusPreview ||
    (vi.fn() as NonNullable<GeneratorToolContext['onRadiusPreview']>)
  const clearRadiusPreview: NonNullable<
    GeneratorToolContext['clearRadiusPreview']
  > =
    overrides?.clearRadiusPreview ||
    (vi.fn() as NonNullable<GeneratorToolContext['clearRadiusPreview']>)
  const setDraftEntities: NonNullable<
    GeneratorToolContext['setDraftEntities']
  > =
    overrides?.setDraftEntities ||
    (vi.fn() as NonNullable<GeneratorToolContext['setDraftEntities']>)
  const clearDraftEntities: NonNullable<
    GeneratorToolContext['clearDraftEntities']
  > =
    overrides?.clearDraftEntities ||
    (vi.fn() as NonNullable<GeneratorToolContext['clearDraftEntities']>)
  const deleteDraftEntities: NonNullable<
    GeneratorToolContext['deleteDraftEntities']
  > =
    overrides?.deleteDraftEntities ||
    (vi.fn() as NonNullable<GeneratorToolContext['deleteDraftEntities']>)

  const mode = new MockSketchMode({
    sceneInfra,
    rustContext,
    kclManager,
    sketchId: 7,
    commitCircle,
    startLineDraft,
    previewLineDraft,
    commitLineDraft,
    startChainedLineDraft,
    onSketchOutcome,
    onRadiusPreview,
    clearRadiusPreview,
    setDraftEntities,
    clearDraftEntities,
    deleteDraftEntities,
  })
  mode.registerTool('circleTool', (context) => new CircleTool(context))
  mode.registerTool('lineTool', (context) => new LineTool(context))

  return {
    mode,
    sceneInfra,
    commitCircle,
    startLineDraft,
    previewLineDraft,
    commitLineDraft,
    startChainedLineDraft,
    onSketchOutcome,
    onRadiusPreview,
    clearRadiusPreview,
    setDraftEntities,
    clearDraftEntities,
    deleteDraftEntities,
  }
}

describe('generatorToolScaffold', () => {
  it('equips the circle tool and registers center-point listeners', async () => {
    const { mode, sceneInfra } = createMode()

    await mode.equipTool('circleTool')

    expect(mode.getSnapshot()).toEqual({
      equippedToolName: 'circleTool',
      instructionType: 'await-center-point',
    })
    expect(sceneInfra.setCallbacks).toHaveBeenCalledTimes(1)
  })

  it('moves into the radius step after the first click and previews on move', async () => {
    const { mode, onRadiusPreview } = createMode()
    await mode.equipTool('circleTool')

    await mode.simulateSceneClick([10, 20])
    await mode.simulateSceneMove([30, 40])

    expect(mode.getSnapshot()).toEqual({
      equippedToolName: 'circleTool',
      instructionType: 'await-radius-point',
    })
    expect(onRadiusPreview).toHaveBeenCalledWith([10, 20], [30, 40])
  })

  it('commits the circle on the second click and loops back to the center step', async () => {
    const { mode, commitCircle, onSketchOutcome, clearRadiusPreview } =
      createMode()
    await mode.equipTool('circleTool')

    await mode.simulateSceneClick([10, 20])
    await mode.simulateSceneClick([30, 40])

    expect(commitCircle).toHaveBeenCalledWith({
      centerPoint: [10, 20],
      startPoint: [30, 40],
    })
    expect(onSketchOutcome).toHaveBeenCalledWith({
      kclSource: { text: 'circle' },
      sceneGraphDelta: expect.any(Object),
    })
    expect(mode.getSnapshot()).toEqual({
      equippedToolName: 'circleTool',
      instructionType: 'await-center-point',
    })
    expect(clearRadiusPreview).toHaveBeenCalled()
  })

  it('cancels the in-progress circle on the first escape and unequips on the second', async () => {
    const { mode, sceneInfra, clearRadiusPreview } = createMode()
    await mode.equipTool('circleTool')
    await mode.simulateSceneClick([10, 20])

    await mode.pressEscape()

    expect(mode.getSnapshot()).toEqual({
      equippedToolName: 'circleTool',
      instructionType: 'await-center-point',
    })

    await mode.pressEscape()

    expect(mode.getSnapshot()).toEqual({
      equippedToolName: null,
      instructionType: null,
    })
    expect(clearRadiusPreview).toHaveBeenCalled()
    expect(sceneInfra.setCallbacks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        onClick: expect.any(Function),
        onMove: expect.any(Function),
      })
    )
  })

  it('lets commit errors bubble instead of swallowing them in nested onError branches', async () => {
    const commitCircle = vi.fn(async () => {
      throw new Error('circle commit failed')
    })
    const { mode } = createMode({ commitCircle })
    await mode.equipTool('circleTool')
    await mode.simulateSceneClick([10, 20])

    await expect(mode.simulateSceneClick([30, 40])).rejects.toThrow(
      'circle commit failed'
    )
  })

  it('starts a line draft on the first click and previews it on move', async () => {
    const { mode, startLineDraft, previewLineDraft, setDraftEntities } =
      createMode()

    await mode.equipTool('lineTool')
    await mode.simulateSceneClick([10, 20])

    expect(startLineDraft).toHaveBeenCalledWith({
      startPoint: [10, 20],
    })
    expect(setDraftEntities).toHaveBeenCalledWith({
      segmentIds: [11, 12],
      constraintIds: [],
    })
    expect(mode.getSnapshot()).toEqual({
      equippedToolName: 'lineTool',
      instructionType: 'preview-draft-line',
    })

    await mode.simulateSceneMove([30, 40])

    expect(previewLineDraft).toHaveBeenCalledWith({
      draftPointId: 101,
      point: [30, 40],
    })
  })

  it('commits a single line and returns to ready when chaining stops', async () => {
    const commitLineDraft: NonNullable<
      GeneratorToolContext['commitLineDraft']
    > = vi.fn(async () => ({
      kclSource: { text: 'line commit' } as SourceDelta,
      sceneGraphDelta: createSceneGraphDelta([], []) as SceneGraphDelta,
      lastPointId: undefined,
    }))
    const { mode, clearDraftEntities } = createMode({ commitLineDraft })

    await mode.equipTool('lineTool')
    await mode.simulateSceneClick([10, 20])
    await mode.simulateSceneClick([30, 40])

    expect(commitLineDraft).toHaveBeenCalledWith({
      draftPointId: 101,
      point: [30, 40],
      isDoubleClick: false,
    })
    expect(clearDraftEntities).toHaveBeenCalled()
    expect(mode.getSnapshot()).toEqual({
      equippedToolName: 'lineTool',
      instructionType: 'await-line-start',
    })
  })

  it('chains into a new draft line after a committed point and a follow-up move', async () => {
    const commitLineDraft: NonNullable<
      GeneratorToolContext['commitLineDraft']
    > = vi.fn(async () => ({
      kclSource: { text: 'line commit' } as SourceDelta,
      sceneGraphDelta: createSceneGraphDelta([], []) as SceneGraphDelta,
      lastPointId: 555,
    }))
    const { mode, startChainedLineDraft, setDraftEntities } = createMode({
      commitLineDraft,
    })

    await mode.equipTool('lineTool')
    await mode.simulateSceneClick([10, 20])
    await mode.simulateSceneClick([30, 40])

    expect(mode.getSnapshot()).toEqual({
      equippedToolName: 'lineTool',
      instructionType: 'await-next-draft-line-start',
    })

    await mode.simulateSceneMove([50, 60])

    expect(startChainedLineDraft).toHaveBeenCalledWith({
      lastPointId: 555,
      draftPoint: [50, 60],
    })
    expect(setDraftEntities).toHaveBeenLastCalledWith({
      segmentIds: [21],
      constraintIds: [31],
    })
    expect(mode.getSnapshot()).toEqual({
      equippedToolName: 'lineTool',
      instructionType: 'preview-draft-line',
    })
  })

  it('cancels the active line draft with escape without unequipping the line tool', async () => {
    const { mode, deleteDraftEntities, clearDraftEntities } = createMode()

    await mode.equipTool('lineTool')
    await mode.simulateSceneClick([10, 20])
    await mode.pressEscape()

    expect(deleteDraftEntities).toHaveBeenCalled()
    expect(clearDraftEntities).toHaveBeenCalled()
    expect(mode.getSnapshot()).toEqual({
      equippedToolName: 'lineTool',
      instructionType: 'await-line-start',
    })
  })

  it('finishes the line chain on double click while waiting to start the next segment', async () => {
    const commitLineDraft: NonNullable<
      GeneratorToolContext['commitLineDraft']
    > = vi.fn(async () => ({
      kclSource: { text: 'line commit' } as SourceDelta,
      sceneGraphDelta: createSceneGraphDelta([], []) as SceneGraphDelta,
      lastPointId: 777,
    }))
    const { mode } = createMode({ commitLineDraft })

    await mode.equipTool('lineTool')
    await mode.simulateSceneClick([10, 20])
    await mode.simulateSceneClick([30, 40])
    await mode.simulateSceneClick([30, 40], { clickCount: 2 })

    expect(mode.getSnapshot()).toEqual({
      equippedToolName: 'lineTool',
      instructionType: 'await-line-start',
    })
  })
})
