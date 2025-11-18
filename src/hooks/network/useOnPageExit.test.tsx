import { renderHook } from '@testing-library/react'
import { useOnPageExit } from '@src/hooks/network/useOnPageExit'
import { expect, vi, describe } from 'vitest'
import { ConnectionManager } from '@src/network/connectionManager'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'

// Helper function to create callbacks used for spying
const createCallback = () => {
  const callback = vi.fn(() => 1)
  return callback
}

describe('useOnPageExit', () => {
  test('on hook unmounted with mocked global singletons', () => {
    const callback = createCallback()
    const engineCommandManager = new ConnectionManager()
    vi.spyOn(engineCommandManager, 'tearDown')
    const sceneInfra = new SceneInfra(engineCommandManager)
    sceneInfra.camControls.oldCameraState = {
      eye_offset: 1.0,
      fov_y: 1.0,
      ortho_scale_enabled: true,
      ortho_scale_factor: 1.0,
      world_coord_system: 'right_handed_up_z',
      is_ortho: true,
      pivot_position: { x: 1.0, y: 1.0, z: 1.0 },
      pivot_rotation: { x: 1.0, y: 1.0, z: 1.0, w: 1.0 },
    }
    expect(callback).toHaveBeenCalledTimes(0)
    expect(engineCommandManager.tearDown).toHaveBeenCalledTimes(0)
    const { unmount } = renderHook(() =>
      useOnPageExit({
        callback,
        engineCommandManager,
        sceneInfra,
      })
    )
    unmount()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(engineCommandManager.tearDown).toHaveBeenCalledTimes(1)
    expect(sceneInfra.camControls.oldCameraState).toBe(undefined)
  })
})
