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

describe('SceneInfra overlay frames', () => {
  afterEach(() => vi.useRealTimers())

  it('updates only the current overlays on the next frame without waiting for a timer', () => {
    vi.useFakeTimers()
    const sceneInfra = makeSceneInfraForCallbacksTest()
    const stale = vi.fn(() => null)
    const current = vi.fn(() => null)
    const send = vi.fn()
    sceneInfra.setSend(send)

    sceneInfra.overlayCallbacks([stale])
    sceneInfra.overlayCallbacks([current])
    vi.advanceTimersToNextFrame()

    expect(stale).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: 'Set Segment Overlays',
      data: { type: 'set-many', overlays: {} },
    })
  })

  it('does not repopulate overlays after the scene stops', () => {
    vi.useFakeTimers()
    const sceneInfra = makeSceneInfraForCallbacksTest()
    const callback = vi.fn(() => null)
    const send = vi.fn()
    sceneInfra.setSend(send)
    sceneInfra.overlayCallbacks([callback])
    sceneInfra.stop()
    vi.advanceTimersToNextFrame()
    vi.advanceTimersByTime(500)

    expect(callback).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('SceneInfra callback resets', () => {
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
