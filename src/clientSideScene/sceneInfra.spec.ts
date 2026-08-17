import { describe, expect, it, vi } from 'vitest'

import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { cameraMouseDragGuards } from '@src/lib/cameraControls'

function makeSceneInfraForCallbacksTest(sendSceneCommand = vi.fn()) {
  return new SceneInfra(
    {
      streamDimensions: { width: 1, height: 1 },
      sendSceneCommand,
      subscribeTo: vi.fn(),
      subscribeToUnreliable: vi.fn(),
    } as any,
    Promise.resolve({} as any),
    () => ({}) as any
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

describe('SceneInfra camera-owned mouse gestures', () => {
  it('still starts sketch selection on an unmodified left drag', () => {
    const sceneInfra = makeSceneInfraForCallbacksTest()
    const solverMouseDownSelection = vi.fn(() => true)
    sceneInfra.camControls.interactionGuards =
      cameraMouseDragGuards['Trackpad Friendly']
    sceneInfra.camControls.cameraOrbitOverride = 'trackball'
    sceneInfra.setCallbacks({
      onMouseDownSelection: solverMouseDownSelection,
    })

    sceneInfra.onMouseDown(
      new MouseEvent('mousedown', {
        button: 0,
        buttons: 1,
      })
    )

    expect(solverMouseDownSelection).toHaveBeenCalledOnce()
    expect(sceneInfra.selected).not.toBeNull()
    expect(sceneInfra.areaSelect).toBeNull()
  })

  it('does not start sketch selection on Trackpad Friendly Option + left drag', () => {
    const sceneInfra = makeSceneInfraForCallbacksTest()
    const solverMouseDownSelection = vi.fn(() => true)
    sceneInfra.camControls.interactionGuards =
      cameraMouseDragGuards['Trackpad Friendly']
    sceneInfra.camControls.cameraOrbitOverride = 'trackball'
    sceneInfra.setCallbacks({
      onMouseDownSelection: solverMouseDownSelection,
    })

    sceneInfra.onMouseDown(
      new MouseEvent('mousedown', {
        altKey: true,
        button: 0,
        buttons: 1,
      })
    )

    expect(solverMouseDownSelection).not.toHaveBeenCalled()
    expect(sceneInfra.selected).toBeNull()
    expect(sceneInfra.areaSelect).toBeNull()
  })

  it('does not turn an unmodified sketch drag into a camera drag when modifiers are pressed', () => {
    const sendSceneCommand = vi.fn()
    const sceneInfra = makeSceneInfraForCallbacksTest(sendSceneCommand)
    sceneInfra.camControls.interactionGuards =
      cameraMouseDragGuards['Trackpad Friendly']

    sceneInfra.camControls.onMouseDown(
      new PointerEvent('pointerdown', { button: 0, buttons: 1, pointerId: 1 })
    )
    sceneInfra.camControls.onMouseMove(
      new PointerEvent('pointermove', {
        altKey: true,
        shiftKey: true,
        button: 0,
        buttons: 1,
        pointerId: 1,
      })
    )

    expect(sendSceneCommand).not.toHaveBeenCalled()
    expect(sceneInfra.camControls.isDragging).toBe(false)
  })

  it('keeps the camera interaction chosen on pointer down until pointer up', () => {
    const sendSceneCommand = vi.fn()
    const sceneInfra = makeSceneInfraForCallbacksTest(sendSceneCommand)
    const canvas = sceneInfra.camControls.domElement
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    sceneInfra.camControls.interactionGuards =
      cameraMouseDragGuards['Trackpad Friendly']

    sceneInfra.camControls.onMouseDown(
      new PointerEvent('pointerdown', {
        altKey: true,
        shiftKey: true,
        button: 0,
        buttons: 1,
        pointerId: 1,
      })
    )
    sceneInfra.camControls.onMouseMove(
      new PointerEvent('pointermove', {
        button: 0,
        buttons: 1,
        clientX: 10,
        clientY: 10,
        pointerId: 1,
      })
    )
    sceneInfra.camControls.onMouseUp(
      new PointerEvent('pointerup', {
        button: 0,
        buttons: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 1,
      })
    )

    const cameraCommands = sendSceneCommand.mock.calls.map(([command]) =>
      command.type === 'modeling_cmd_req' ? command.cmd : null
    )
    expect(cameraCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'camera_drag_start',
          interaction: 'pan',
        }),
        expect.objectContaining({
          type: 'camera_drag_move',
          interaction: 'pan',
        }),
        expect.objectContaining({
          type: 'camera_drag_end',
          interaction: 'pan',
        }),
      ])
    )
    expect(sceneInfra.camControls.isDragging).toBe(false)
    expect(sceneInfra.camControls.activeDragInteraction).toBeNull()

    sendSceneCommand.mockClear()
    sceneInfra.camControls.onMouseDown(
      new PointerEvent('pointerdown', { button: 0, buttons: 1, pointerId: 2 })
    )
    sceneInfra.camControls.onMouseMove(
      new PointerEvent('pointermove', {
        button: 0,
        buttons: 1,
        clientX: 20,
        clientY: 20,
        pointerId: 2,
      })
    )

    expect(sendSceneCommand).not.toHaveBeenCalled()
  })
})
