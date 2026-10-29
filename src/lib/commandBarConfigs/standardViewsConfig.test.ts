import type { KclManager } from '@src/lang/KclManager'
import { createStandardViewsCommands } from '@src/lib/commandBarConfigs/standardViewsConfig'
import * as utils from '@src/lib/utils'
import { fitSketch3dView } from '@src/clientSideScene/sketch3dView'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/clientSideScene/sketch3dView', () => ({
  fitSketch3dView: vi.fn(() => true),
}))

describe('zoom to fit with spatial sketches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fitSketch3dView).mockReturnValue(true)
  })
  afterEach(() => vi.restoreAllMocks())
  function manager(spatial: boolean, hasPath = false) {
    return {
      engineCommandManager: {},
      sceneInfra: { camControls: {} },
      artifactGraph: new Map(hasPath ? [['path', { type: 'path' }]] : []),
      execState: {
        spatialSketches: spatial
          ? [{ kind: { type: 'Sketch3d', segments: [] } }]
          : [],
      },
    } as unknown as KclManager
  }
  it('fits client geometry instead of asking the engine to fit an empty scene', () => {
    const engineFit = vi
      .spyOn(utils, 'engineStreamZoomToFit')
      .mockResolvedValue(undefined)
    const editor = manager(true)
    createStandardViewsCommands(editor).zoomToFitCommand.onSubmit?.({})
    expect(fitSketch3dView).toHaveBeenCalledWith(
      [],
      editor.sceneInfra.camControls
    )
    expect(engineFit).not.toHaveBeenCalled()
  })
  it('preserves engine zoom to fit for normal geometry', () => {
    const engineFit = vi
      .spyOn(utils, 'engineStreamZoomToFit')
      .mockResolvedValue(undefined)
    createStandardViewsCommands(manager(false)).zoomToFitCommand.onSubmit?.({})
    createStandardViewsCommands(
      manager(true, true)
    ).zoomToFitCommand.onSubmit?.({})
    expect(engineFit).toHaveBeenCalledTimes(2)
    expect(fitSketch3dView).not.toHaveBeenCalled()
  })
})
