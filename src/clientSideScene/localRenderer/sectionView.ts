import {
  type Box3,
  MathUtils,
  type Object3D,
  Plane,
  Scene,
  Vector3,
} from 'three'
import { ClippingGroup } from 'three/webgpu'
import type { LocalViewportOptions } from '@src/clientSideScene/localRenderer/viewportOptions'

export function getSectionPlane(
  bounds: Box3,
  options: LocalViewportOptions
): Plane | null {
  if (!options.sectionEnabled || bounds.isEmpty()) return null

  // The controls use engine axes (Z-up); the scene uses glTF axes (Y-up).
  const normal =
    options.sectionPlane === 'XY'
      ? new Vector3(0, 1, 0)
      : options.sectionPlane === 'XZ'
        ? new Vector3(0, 0, -1)
        : new Vector3(1, 0, 0)
  const a = normal.dot(bounds.min)
  const b = normal.dot(bounds.max)
  const offset = MathUtils.lerp(
    Math.min(a, b),
    Math.max(a, b),
    options.sectionPosition / 100
  )
  const plane = new Plane(normal, -offset)
  return options.sectionReversed ? plane.negate() : plane
}

export function setSectionPlane(group: ClippingGroup, plane: Plane | null) {
  group.enabled = plane !== null
  group.clippingPlanes = plane ? [plane] : []
}

/** Picking and highlights flatten the source hierarchy. Retain its section cut,
 * while leaving reference planes outside the model's clipping group. */
export class SectionViewScene extends Scene {
  private readonly sectionGroup = new ClippingGroup()

  setSectionPlane(plane: Plane | null) {
    setSectionPlane(this.sectionGroup, plane)
  }

  addProxy(source: Object3D, proxy: Object3D) {
    for (let parent = source.parent; parent; parent = parent.parent) {
      if (parent instanceof ClippingGroup) {
        this.sectionGroup.add(proxy)
        this.add(this.sectionGroup)
        return
      }
    }
    this.add(proxy)
  }

  override clear() {
    this.sectionGroup.clear()
    return super.clear()
  }
}
