import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { cameraMouseDragGuards } from '@src/lib/cameraControls'
import { describe, expect, it, vi } from 'vitest'

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

describe('SceneInfra camera gestures', () => {
  it('reserves Creo Ctrl+left-drag for the camera without starting sketch edits', () => {
    const sceneInfra = makeSceneInfraForCallbacksTest()
    sceneInfra.camControls.interactionGuards = cameraMouseDragGuards.Creo
    const onMouseDownSelection = vi.fn(() => true)
    sceneInfra.setCallbacks({ onMouseDownSelection })
    sceneInfra.onMouseDown(
      new MouseEvent('mousedown', { button: 0, buttons: 1, ctrlKey: true })
    )
    expect(onMouseDownSelection).not.toHaveBeenCalled()
    expect(sceneInfra.selected).toBeNull()
    expect(sceneInfra.areaSelect).toBeNull()
  })

  it('allows a stationary Creo Ctrl+click to select', async () => {
    const sceneInfra = makeSceneInfraForCallbacksTest()
    sceneInfra.camControls.interactionGuards = cameraMouseDragGuards.Creo
    const onClick = vi.fn()
    sceneInfra.setCallbacks({ onClick })
    await sceneInfra.onMouseUp(
      new MouseEvent('mouseup', { button: 0, ctrlKey: true })
    )
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not select on mouse up after a camera drag', async () => {
    const sceneInfra = makeSceneInfraForCallbacksTest()
    const onClick = vi.fn()
    sceneInfra.setCallbacks({ onClick })
    sceneInfra.camControls.wasDragging = true
    await sceneInfra.onMouseUp(
      new MouseEvent('mouseup', { button: 0, ctrlKey: true })
    )
    expect(onClick).not.toHaveBeenCalled()
    expect(sceneInfra.selected).toBeNull()
    expect(sceneInfra.areaSelect).toBeNull()
  })
})
