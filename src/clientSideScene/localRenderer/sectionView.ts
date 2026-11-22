import {
  type Box3,
  MathUtils,
  type Object3D,
  Plane,
  Scene,
  Vector3,
  Vector4,
} from 'three'
import { ClippingGroup } from 'three/webgpu'
import {
  attribute,
  modelWorldMatrix,
  positionGeometry,
  uniform,
  varying,
  vec4,
} from 'three/tsl'
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

/** Clip the line itself as well as its expanded screen-space ribbon. Otherwise
 * a wide pick target can reach across the cut from an entirely removed edge. */
export class SectionLineClipping {
  private readonly plane = uniform(new Vector4(0, 0, 0, 1))
  readonly maskNode = varying(
    modelWorldMatrix.mul(
      vec4(
        positionGeometry.y
          .lessThan(0.5)
          .select(
            attribute('instanceStart', 'vec3'),
            attribute('instanceEnd', 'vec3')
          ),
        1
      )
    ).xyz
  )
    .dot(this.plane.xyz)
    .add(this.plane.w)
    .greaterThanEqual(0)

  setPlane(plane: Plane | null) {
    if (plane) {
      this.plane.value.set(
        plane.normal.x,
        plane.normal.y,
        plane.normal.z,
        plane.constant
      )
    } else {
      this.plane.value.set(0, 0, 0, 1)
    }
  }
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
