import type * as SketchGraph from '@src/machines/sketchSolve/sketchSceneGraph'
import { nativeSketchDelta } from '@src/lib/kcl/sketch/correspondenceTestUtils'
import { expect, it, vi } from 'vitest'
import { Scene, Group, Mesh, BoxGeometry, MeshBasicMaterial } from 'three'
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

it('gives native selection and hover precedence over styling and expires groups with a new graph', () => {
  const view = modelingTestContext(),
    canvas = document.createElement('canvas')
  const infra = {
    scene: new Scene(),
    renderer: { domElement: canvas },
    getClientSceneScaleFactor: () => 1,
    resumeRendering: vi.fn(),
    setOnBeforeRender: vi.fn(),
    resetMouseListeners: vi.fn(),
  } as unknown as SceneInfra
  const surface = createSketchSurface(
    infra,
    view.context.settings,
    { entityId: 'xy', origin: [0, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1] },
    0
  )
  try {
    const delta = nativeSketchDelta(),
      target = new Group(),
      mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
    target.name = '1'
    target.add(mesh)
    surface.group.add(target)
    surface.render(delta)
    const handle = surface.entityStyling.createGroup({
      color: [0.1, 0.5, 0.8],
      fillOpacity: 0.09,
      outlineOpacity: 0.4,
      lineWidth: 1,
      priority: 10,
    })
    if (handle instanceof Error) throw handle
    handle.set([1])
    const overlay = infra.scene.getObjectByName('entity-styling')!
    expect(overlay.children).toHaveLength(1)
    surface.select([1], true)
    expect(overlay.children).toEqual([])
    surface.select([], true)
    expect(overlay.children).toHaveLength(1)
    surface.hover(1)
    expect(overlay.children).toEqual([])
    surface.hover(null)
    expect(overlay.children).toHaveLength(1)
    surface.render({ ...delta, invalidates_ids: true })
    expect(overlay.children).toEqual([])
    expect(handle.set([1])).toBeInstanceOf(Error)
  } finally {
    surface.dispose()
    view.dispose()
  }
})

vi.mock('@src/machines/sketchSolve/sketchSceneGraph', async (original) => ({
  ...(await original<typeof SketchGraph>()),
  updateSceneGraphFromDelta: vi.fn(),
}))
