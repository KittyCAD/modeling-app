import { renderHook } from '@testing-library/react'
import type { IUseOnPageExit } from '@src/hooks/network/useOnPageExit'
import { useOnPageExit } from '@src/hooks/network/useOnPageExit'
import { vi } from 'vitest'

// Helper function to create callbacks used for spying
const createCallback = () => {
  const callback = vi.fn(() => 1)
  return callback
}

const createMockedEngineCommandManager = () => {
  const engineCommandManager = {
    tearDown: vi.fn(() => 2),
  }
  return engineCommandManager
}

const DEFAULT_OLD_CAMERA_STATE = 'some-old-state'
const createMockedSceneInfra = () => {
  const sceneInfra = {
    camControls: {
      oldCameraState: DEFAULT_OLD_CAMERA_STATE,
    },
  }
  return sceneInfra
}

describe('useOnPageExit tests', () => {
  test('attempt', () => {
    const callback = createCallback()
    const engineCommandManager = createMockedEngineCommandManager()
    const sceneInfra = createMockedSceneInfra()
    expect(callback).toHaveBeenCalledTimes(0)
    expect(engineCommandManager.tearDown).toHaveBeenCalledTimes(0)
    expect(sceneInfra.camControls.oldCameraState).toBe(DEFAULT_OLD_CAMERA_STATE)
    const { unmount } = renderHook(() =>
      useOnPageExit({
        callback,
        engineCommandManager,
        sceneInfra,
      } as unknown as IUseOnPageExit)
    )
    unmount()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(engineCommandManager.tearDown).toHaveBeenCalledTimes(1)
    expect(sceneInfra.camControls.oldCameraState).toBe(undefined)
  })
})
