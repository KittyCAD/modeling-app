import { isArray } from '@src/lib/utils'
import { type Object3D, type Group, BufferGeometry, Material } from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'

/**
 * Dispose of all children (and grandchildren...) of a THREE.Group or Object3D.
 * Frees geometries, materials, and textures to prevent memory leaks.
 * @param rootGroup The THREE.Group whose children will be disposed and removed.
 */
export function disposeGroupChildren(rootGroup: Group): void {
  // Recursively traverse and dispose of child objects
  for (let i = rootGroup.children.length - 1; i >= 0; i--) {
    const child = rootGroup.children[i]
    disposeObject(child)
    // After disposing resources, remove the child from the group
    rootGroup.remove(child)
  }
}

function disposeObject(obj: Object3D): void {
  // Recursively dispose children first (depth-first traversal)
  for (let i = obj.children.length - 1; i >= 0; i--) {
    disposeObject(obj.children[i])
    obj.remove(obj.children[i])
  }

  // CSS2DObject needs special handling: remove its DOM element from the DOM
  // before removing it from the Three.js scene graph
  if (obj instanceof CSS2DObject) {
    obj.element.remove()
  }

  // Dispose geometry if present
  if ('geometry' in obj && obj.geometry instanceof BufferGeometry) {
    obj.geometry.dispose()
  }

  // Dispose material(s) if present
  if ('material' in obj) {
    const material = obj.material
    if (material instanceof Material) {
      disposeMaterial(material)
    } else if (isArray(material)) {
      // Array of materials (e.g., multi-material object)
      material.forEach((mat) => {
        if (mat instanceof Material) {
          disposeMaterial(mat)
        }
      })
    }
  }
  // Note: After this, the object can be safely removed by its parent.
}

function disposeMaterial(material: Material): void {
  // Clean up custom shader properties before disposal
  // This ensures shader programs and callbacks are properly released
  // Note: delete is safe even if the property doesn't exist
  if ('onBeforeCompile' in material) {
    delete (material as any).onBeforeCompile
  }
  if ('customProgramCacheKey' in material) {
    delete (material as any).customProgramCacheKey
  }

  // Clear any custom uniforms that might hold references
  // (Three.js will handle standard uniforms, but custom ones from onBeforeCompile need cleanup)
  // Note: Uniforms are stored in the shader object, not directly on material,
  // but we clear them defensively in case they're accessible
  if ('uniforms' in material && (material as any).uniforms) {
    const uniforms = (material as any).uniforms
    // Clear custom uniforms that we added (uSegmentStart, uSegmentEnd, uArcCenter, etc.)
    if (uniforms.uSegmentStart) delete uniforms.uSegmentStart
    if (uniforms.uSegmentEnd) delete uniforms.uSegmentEnd
    if (uniforms.uArcCenter) delete uniforms.uArcCenter
    if (uniforms.uArcStart) delete uniforms.uArcStart
    if (uniforms.uArcStartAngle) delete uniforms.uArcStartAngle
    if (uniforms.uArcEndAngle) delete uniforms.uArcEndAngle
  }

  // Dispose of textures associated with the material
  // if we ever start using textures in the sketch scene
  material.dispose()
}
