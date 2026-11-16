import { expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector3,
} from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { ObjectStylingRenderer } from '@src/lib/scene/ObjectStylingRenderer'
import type { EntityStyle } from '@src/lib/scene/entityStyling'

const style: EntityStyle = {
  color: [0.1, 0.5, 0.8],
  fillOpacity: 0.09,
  outlineOpacity: 0.4,
  lineWidth: 1,
  priority: 10,
}
it('overlays native lines with separate materials while preserving geometry, picking, and parent transforms', () => {
  const scene = new Scene(),
    parent = new Group(),
    geometry = new LineGeometry().setPositions([0, 0, 0, 1, 0, 0])
  const material = new LineMaterial({ color: 0xff0000, linewidth: 3 }),
    line = new Line2(geometry, material)
  // Simulate a fat line from a different Three module's constructor hierarchy.
  Object.setPrototypeOf(line, Mesh.prototype)
  parent.position.set(5, 7, 0)
  parent.add(line)
  scene.add(parent)
  const geometryDisposed = vi.spyOn(geometry, 'dispose'),
    styling = new ObjectStylingRenderer(scene)
  try {
    styling.setGroups([{ id: Symbol(), style, targets: [line] }])
    const root = scene.getObjectByName('entity-styling')!,
      overlay = root.children[0] as Line2
    expect(overlay.isLineSegments2).toBe(true)
    expect(overlay.geometry).toBe(geometry)
    expect(overlay.material).not.toBe(material)
    expect(overlay.material.opacity).toBe(0.4)
    expect(overlay.material.linewidth).toBe(1)
    expect(material.opacity).toBe(1)
    expect(material.linewidth).toBe(3)
    expect(material.color.getHex()).toBe(0xff0000)
    root.updateMatrixWorld(true)
    expect(overlay.getWorldPosition(new Vector3())).toEqual(
      new Vector3(5, 7, 0)
    )
    const hits: unknown[] = []
    overlay.raycast({} as never, hits as never)
    expect(hits).toEqual([])
    parent.visible = false
    styling.update()
    expect(overlay.visible).toBe(false)
    styling.setGroups([])
    expect(root.children).toEqual([])
    expect(geometryDisposed).not.toHaveBeenCalled()
  } finally {
    styling.dispose()
    geometry.dispose()
    material.dispose()
  }
})
it('resolves opaque group overlap by priority and restores lower styling after removal', () => {
  const scene = new Scene(),
    source = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  scene.add(source)
  const styling = new ObjectStylingRenderer(scene),
    low = { id: Symbol(), style, targets: [source] },
    high = {
      id: Symbol(),
      style: { ...style, color: [1, 0, 0] as const, priority: 100 },
      targets: [source],
    }
  try {
    styling.setGroups([high, low])
    const root = scene.getObjectByName('entity-styling')!,
      overlay = root.children[0] as Mesh<BoxGeometry, MeshBasicMaterial>
    expect(root.children).toHaveLength(1)
    expect(overlay.material.color).toEqual(new Color(1, 0, 0))
    styling.setGroups([low])
    expect(overlay.material.color).not.toEqual(new Color(1, 0, 0))
    const disposed = vi.spyOn(overlay.material, 'dispose')
    styling.dispose()
    expect(disposed).toHaveBeenCalledOnce()
    expect(scene.children).toEqual([source])
  } finally {
    source.geometry.dispose()
    source.material.dispose()
  }
})
