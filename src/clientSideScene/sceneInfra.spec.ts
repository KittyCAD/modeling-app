import { afterEach, describe, expect, it, vi } from 'vitest'

import { SceneInfra } from '@src/clientSideScene/sceneInfra'

function makeSceneInfraForCallbacksTest() {
  return new SceneInfra(
    {
      streamDimensions: { width: 1, height: 1 },
      sendSceneCommand: vi.fn(),
      subscribeTo: vi.fn(),
      subscribeToUnreliable: vi.fn(),
    } as any,
    Promise.resolve({} as any),
    () => ({}) as any
  )
}

describe('SceneInfra callback resets', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears solver-only mouse down selection callback when listeners reset', () => {
    const sceneInfra = makeSceneInfraForCallbacksTest()
    const solverMouseDownSelection = vi.fn(() => false)

    sceneInfra.setCallbacks({
      onMouseDownSelection: solverMouseDownSelection,
    })
    expect(sceneInfra.onMouseDownSelection).toBe(solverMouseDownSelection)

    sceneInfra.resetMouseListeners()

    expect(sceneInfra.onMouseDownSelection).toBeUndefined()
  })

  it('does not start duplicate animation loops', () => {
    const requestAnimationFrame = vi.fn(() => 12)
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
    const sceneInfra = makeSceneInfraForCallbacksTest()
    sceneInfra.renderer.clear = vi.fn()

    sceneInfra.animate()
    sceneInfra.animate()
    sceneInfra.stop()

    expect(requestAnimationFrame).toHaveBeenCalledOnce()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(12)
  })
})

describe('SceneInfra non-primary mouse buttons', () => {
  it('does not start sketch selection or area selection on middle mouse down', () => {
    const sceneInfra = makeSceneInfraForCallbacksTest()
    const solverMouseDownSelection = vi.fn(() => true)

    sceneInfra.setCallbacks({
      onMouseDownSelection: solverMouseDownSelection,
    })

    sceneInfra.onMouseDown(
      new MouseEvent('mousedown', { button: 1, buttons: 4 })
    )

    expect(solverMouseDownSelection).not.toHaveBeenCalled()
    expect(sceneInfra.selected).toBeNull()
    expect(sceneInfra.areaSelect).toBeNull()
  })

  it('does not send a sketch click on middle mouse up', async () => {
    const sceneInfra = makeSceneInfraForCallbacksTest()
    const onClick = vi.fn()

    sceneInfra.setCallbacks({
      onClick,
    })

    await sceneInfra.onMouseUp(
      new MouseEvent('mouseup', { button: 1, buttons: 0 })
    )

    expect(onClick).not.toHaveBeenCalled()
  })
})
