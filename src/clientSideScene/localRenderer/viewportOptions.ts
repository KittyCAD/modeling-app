import { Mesh, MeshStandardMaterial, type Object3D } from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { isArray } from '@src/lib/utils'
import { MeshStandardNodeMaterial } from 'three/webgpu'

export type LocalViewportOptions = {
  showBreps: boolean
  showSketches: boolean
  style: 'shaded' | 'faceted' | 'wireframe'
  opacity: number
  resolutionScale: 1 | 1.5 | 2
  brightness: number
  contrast: number
  sectionEnabled: boolean
  sectionPlane: 'XY' | 'XZ' | 'YZ'
  sectionPosition: number
  sectionReversed: boolean
}

export const DEFAULT_LOCAL_VIEWPORT_OPTIONS: LocalViewportOptions = {
  showBreps: true,
  showSketches: true,
  style: 'shaded',
  opacity: 100,
  resolutionScale: 1.5,
  brightness: 100,
  contrast: 100,
  sectionEnabled: false,
  sectionPlane: 'XY',
  sectionPosition: 50,
  sectionReversed: false,
}

// Bound the combined scene, picking and post-processing buffers on large displays.
const MAX_VIEWPORT_PIXELS = 16_777_216

export function getViewportPixelRatio(
  width: number,
  height: number,
  devicePixelRatio: number,
  resolutionScale: number,
  maxTextureDimension: number
) {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  return Math.min(
    devicePixelRatio * resolutionScale,
    maxTextureDimension / Math.max(w, h),
    Math.sqrt(MAX_VIEWPORT_PIXELS / (w * h))
  )
}

export function isVisibleInViewport(object: Object3D): boolean {
  for (
    let current: Object3D | null = object;
    current;
    current = current.parent
  ) {
    if (!current.visible) return false
  }
  return true
}

/** Retain imported visibility and material properties when restoring the view. */
export class ViewportAppearance {
  private readonly visibility = new WeakMap<Mesh, boolean>()
  private readonly materials = new WeakMap<
    MeshStandardMaterial | MeshStandardNodeMaterial,
    {
      opacity: number
      transparent: boolean
      depthWrite: boolean
      wireframe: boolean
      flatShading: boolean
    }
  >()

  apply(model: Object3D, options: LocalViewportOptions) {
    model.traverse((object) => {
      if (!(object instanceof Mesh) || object instanceof LineSegments2) return
      if (!this.visibility.has(object))
        this.visibility.set(object, object.visible)
      object.visible =
        this.visibility.get(object) !== false &&
        (object.userData.isSketchRegion
          ? options.showSketches
          : object.userData.isBrep
            ? options.showBreps
            : true)
      if (object.userData.isSketchRegion) return
      for (const material of isArray(object.material)
        ? object.material
        : [object.material]) {
        if (
          !(material instanceof MeshStandardMaterial) &&
          !(material instanceof MeshStandardNodeMaterial)
        )
          continue
        let original = this.materials.get(material)
        if (!original) {
          original = {
            opacity: material.opacity,
            transparent: material.transparent,
            depthWrite: material.depthWrite,
            wireframe: material.wireframe,
            flatShading: material.flatShading,
          }
          this.materials.set(material, original)
        }
        const opacity = (original.opacity * options.opacity) / 100
        const transparent = original.transparent || options.opacity < 100
        const wireframe = original.wireframe || options.style === 'wireframe'
        const flatShading = original.flatShading || options.style === 'faceted'
        const needsUpdate =
          material.transparent !== transparent ||
          material.wireframe !== wireframe ||
          material.flatShading !== flatShading
        material.opacity = opacity
        material.transparent = transparent
        material.depthWrite = original.depthWrite && options.opacity === 100
        material.wireframe = wireframe
        material.flatShading = flatShading
        if (needsUpdate) material.needsUpdate = true
      }
    })
  }
}
