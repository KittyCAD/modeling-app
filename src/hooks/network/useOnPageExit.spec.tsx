import { renderHook } from '@testing-library/react'
import { useOnPageExit } from '@src/hooks/network/useOnPageExit'
import { expect, vi, describe, test } from 'vitest'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

// Helper function to create callbacks used for spying
const createCallback = () => {
  const callback = vi.fn(() => 1)
  return callback
}

describe('useOnPageExit', () => {
  test('on hook unmounted with mocked global singletons', async () => {
    const callback = createCallback()
    const { engineCommandManager, sceneInfra } =
      await buildTheWorldAndNoEngineConnection(true)
    vi.spyOn(engineCommandManager, 'tearDown')
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
    // eslint-disable-next-line @typescript-eslint/unbound-method
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
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(engineCommandManager.tearDown).toHaveBeenCalledTimes(1)
    expect(sceneInfra.camControls.oldCameraState).toBe(undefined)
  })
})
