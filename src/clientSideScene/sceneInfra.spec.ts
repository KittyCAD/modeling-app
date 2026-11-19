import { afterEach, describe, expect, it, vi } from 'vitest'

import { cameraMouseDragGuards } from '@src/lib/cameraControls'

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

describe('CATIA sketch input', () => {
  it('does not select, drag or click a sketch entity during a left-button camera chord', async () => {
    const sceneInfra = makeSceneInfraForCallbacksTest()
    const canvas = document.createElement('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    sceneInfra.camControls.domElement = canvas
    sceneInfra.camControls.enableRotate = false
    sceneInfra.camControls.interactionGuards = cameraMouseDragGuards.CATIA
    const onMouseDownSelection = vi.fn(() => true)
    const onClick = vi.fn()
    const onDrag = vi.fn()
    sceneInfra.setCallbacks({ onMouseDownSelection, onClick, onDrag })
    sceneInfra.camControls.onMouseDown(
      new PointerEvent('pointerdown', { button: 1, buttons: 4 })
    )
    sceneInfra.camControls.onMouseMove(
      new PointerEvent('pointermove', { button: 0, buttons: 5 })
    )
    sceneInfra.onMouseDown(
      new MouseEvent('mousedown', { button: 0, buttons: 5 })
    )
    await sceneInfra.onMouseMove(
      new MouseEvent('mousemove', { buttons: 5, clientX: 100 })
    )
    sceneInfra.camControls.onMouseMove(
      new PointerEvent('pointermove', { button: 0, buttons: 4 })
    )
    await sceneInfra.onMouseUp(
      new MouseEvent('mouseup', { button: 0, buttons: 4 })
    )
    sceneInfra.camControls.onMouseMove(
      new PointerEvent('pointermove', { button: 0, buttons: 5 })
    )
    sceneInfra.camControls.onMouseMove(
      new PointerEvent('pointermove', { button: 1, buttons: 1 })
    )
    sceneInfra.camControls.onMouseUp(
      new PointerEvent('pointerup', { button: 0, buttons: 0 })
    )
    await sceneInfra.onMouseUp(
      new MouseEvent('mouseup', { button: 0, buttons: 0 })
    )
    expect(onMouseDownSelection).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
    expect(onDrag).not.toHaveBeenCalled()
    expect(sceneInfra.selected).toBeNull()
    expect(sceneInfra.areaSelect).toBeNull()
  })
})
