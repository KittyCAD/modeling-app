import { expect, it, vi } from 'vitest'
import { Scene } from 'three'
import { createSketchSurface } from '@src/lib/kcl/sketch/surface'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { modelingTestContext } from '@src/lib/kcl/testContext'

it('forwards mounted sketch DOM input through SceneInfra and detaches it on exit', async () => {
  const view = modelingTestContext()
  const canvas = document.createElement('canvas')
  const down = vi.fn(),
    move = vi.fn(async () => {}),
    up = vi.fn(async (_event: MouseEvent) => {})
  const infra = {
    scene: new Scene(),
    renderer: { domElement: canvas },
    getClientSceneScaleFactor: () => 1,
    setOnBeforeRender: vi.fn(),
    resetMouseListeners: vi.fn(),
    onMouseDown: down,
    onMouseMove: move,
    onMouseUp: up,
  } as unknown as SceneInfra
  const surface = createSketchSurface(
    infra,
    view.context.settings,
    { entityId: 'xy', origin: [0, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1] },
    0
  )
  canvas.dispatchEvent(
    new MouseEvent('mousedown', { button: 0, clientX: 20, clientY: 30 })
  )
  canvas.dispatchEvent(
    new MouseEvent('mousemove', { clientX: 25, clientY: 35 })
  )
  canvas.dispatchEvent(
    new MouseEvent('mouseup', { button: 0, clientX: 25, clientY: 35 })
  )
  await vi.waitFor(() => expect(up).toHaveBeenCalledOnce())
  expect(down).toHaveBeenCalledOnce()
  expect(move).toHaveBeenCalledOnce()
  expect(up.mock.calls[0]?.[0]).toMatchObject({ clientX: 25, clientY: 35 })
  surface.dispose()
  canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0 }))
  expect(up).toHaveBeenCalledOnce()
  expect(infra.scene.children).toHaveLength(0)
  view.dispose()
})
