import { describe, expect, it, vi } from 'vitest'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  CircleTool,
  MockSketchMode,
  type CircleCommitResult,
  type GeneratorToolContext,
} from '@src/machines/sketchSolve/tools/generatorToolScaffold'
import {
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function createMode(overrides?: {
  commitCircle?: NonNullable<GeneratorToolContext['commitCircle']>
  onSketchOutcome?: NonNullable<GeneratorToolContext['onSketchOutcome']>
  onRadiusPreview?: NonNullable<GeneratorToolContext['onRadiusPreview']>
  clearRadiusPreview?: NonNullable<GeneratorToolContext['clearRadiusPreview']>
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

  const mode = new MockSketchMode({
    sceneInfra,
    rustContext,
    kclManager,
    sketchId: 7,
    commitCircle,
    onSketchOutcome,
    onRadiusPreview,
    clearRadiusPreview,
  })
  mode.registerTool('circleTool', (context) => new CircleTool(context))

  return {
    mode,
    sceneInfra,
    commitCircle,
    onSketchOutcome,
    onRadiusPreview,
    clearRadiusPreview,
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
    mode.simulateSceneMove([30, 40])

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
})
