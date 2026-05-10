import { describe, expect, it, vi } from 'vitest'

import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { cameraMouseDragGuards } from '@src/lib/cameraControls'

function makeSceneInfraForCallbacksTest(cameraOrbit = 'spherical') {
  return new SceneInfra(
    {
      streamDimensions: { width: 1, height: 1 },
      sendSceneCommand: vi.fn(),
      subscribeTo: vi.fn(),
      subscribeToUnreliable: vi.fn(),
    } as any,
    Promise.resolve({} as any),
    () =>
      ({
        modeling: {
          cameraOrbit: {
            current: cameraOrbit,
          },
        },
      }) as any
  )
}

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

describe('SceneInfra animation loop', () => {
  it('does not create duplicate requestAnimationFrame loops for repeated animate calls', () => {
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockReturnValue(1)
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')
    const sceneInfra = makeSceneInfraForCallbacksTest()
    sceneInfra.renderer.clear = vi.fn()
    requestAnimationFrame.mockClear()
    cancelAnimationFrame.mockClear()

    sceneInfra.animate()
    sceneInfra.animate()

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)

    sceneInfra.stop()
    expect(cancelAnimationFrame).not.toHaveBeenCalled()

    sceneInfra.stop()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)

    requestAnimationFrame.mockRestore()
    cancelAnimationFrame.mockRestore()
  })

  it('can stop without clearing the last client-side frame', () => {
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockReturnValue(1)
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')
    const sceneInfra = makeSceneInfraForCallbacksTest()
    sceneInfra.renderer.clear = vi.fn()

    sceneInfra.animate()
    sceneInfra.stop({ clear: false })

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(sceneInfra.renderer.clear).not.toHaveBeenCalled()

    requestAnimationFrame.mockRestore()
    cancelAnimationFrame.mockRestore()
  })
})

describe('SceneInfra camera controls', () => {
  it('prevents browser defaults when a pointer down starts a camera gesture', () => {
    const sceneInfra = makeSceneInfraForCallbacksTest('trackball')
    const controls = sceneInfra.camControls
    const rightMouseDown = new MouseEvent('pointerdown', {
      clientX: 12,
      clientY: 34,
      buttons: 2,
      button: 2,
      cancelable: true,
    }) as PointerEvent
    Object.defineProperty(rightMouseDown, 'pointerId', { value: 1 })
    const preventDefault = vi.spyOn(rightMouseDown, 'preventDefault')
    controls.interactionGuards = cameraMouseDragGuards.OnShape
    controls.domElement.setPointerCapture = vi.fn()

    controls.onMouseDown(rightMouseDown)

    expect(preventDefault).toHaveBeenCalled()
  })

  it('uses the configured mouse controls when selecting trackball orbit', () => {
    const sceneInfra = makeSceneInfraForCallbacksTest('trackball')
    const controls = sceneInfra.camControls
    const rightMouseDrag = new MouseEvent('mousemove', {
      buttons: 2,
      button: 2,
    })

    controls.interactionGuards = cameraMouseDragGuards.OnShape
    expect(controls.getInteractionType(rightMouseDrag)).toBe('rotatetrackball')

    controls.interactionGuards = cameraMouseDragGuards.Solidworks
    expect(controls.getInteractionType(rightMouseDrag)).toBe('none')
  })

  it('rotates the local camera with trackball orbit controls', () => {
    const sceneInfra = makeSceneInfraForCallbacksTest()
    const controls = sceneInfra.camControls
    controls.syncDirection = 'clientToEngine'
    controls.target.set(0, 0, 0)
    controls.camera.position.set(0, -10, 0)
    controls.camera.up.set(0, 0, 1)
    controls.camera.lookAt(controls.target)
    controls.camera.updateMatrixWorld()

    const initialPosition = controls.camera.position.clone()
    const initialUp = controls.camera.up.clone()

    controls.rotateCameraTrackball(20, 20)

    expect(controls.camera.position.equals(initialPosition)).toBe(false)
    expect(controls.camera.up.equals(initialUp)).toBe(false)
    expect(controls.camera.position.distanceTo(controls.target)).toBeCloseTo(
      initialPosition.distanceTo(controls.target)
    )
  })

  it('resets local drag anchors when modifier keys switch camera interaction modes', () => {
    const sceneInfra = makeSceneInfraForCallbacksTest()
    const controls = sceneInfra.camControls
    controls.syncDirection = 'clientToEngine'
    controls.interactionGuards = cameraMouseDragGuards.Zoo
    controls.domElement.setPointerCapture = vi.fn()
    controls.domElement.releasePointerCapture = vi.fn()

    const pointerDown = new MouseEvent('pointerdown', {
      clientX: 10,
      clientY: 10,
      buttons: 2,
      button: 2,
      cancelable: true,
    }) as PointerEvent
    Object.defineProperty(pointerDown, 'pointerId', { value: 1 })
    controls.onMouseDown(pointerDown)

    const orbitMove = new MouseEvent('pointermove', {
      clientX: 20,
      clientY: 20,
      buttons: 2,
      button: 2,
    }) as PointerEvent
    controls.onMouseMove(orbitMove)
    expect(controls.pendingRotation).not.toBeNull()

    const switchToPan = new MouseEvent('pointermove', {
      clientX: 21,
      clientY: 21,
      buttons: 2,
      button: 2,
      shiftKey: true,
    }) as PointerEvent
    controls.onMouseMove(switchToPan)
    expect(controls.pendingRotation).toBeNull()
    expect(controls.pendingPan).toBeNull()

    const panMove = new MouseEvent('pointermove', {
      clientX: 30,
      clientY: 30,
      buttons: 2,
      button: 2,
      shiftKey: true,
    }) as PointerEvent
    controls.onMouseMove(panMove)
    expect(controls.pendingPan).not.toBeNull()

    const switchToZoom = new MouseEvent('pointermove', {
      clientX: 31,
      clientY: 31,
      buttons: 2,
      button: 2,
      ctrlKey: true,
    }) as PointerEvent
    controls.onMouseMove(switchToZoom)
    expect(controls.pendingPan).toBeNull()
    expect(controls.pendingZoom).toBeNull()
  })
})
