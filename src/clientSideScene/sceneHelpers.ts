import { hasProperty, isArray, isRecord } from '@src/lib/utils'
import { type Object3D, type Group, BufferGeometry, Material } from 'three'

/**
 * Dispose of all children (and grandchildren...) of a THREE.Group or Object3D.
 * Frees geometries, materials, and textures to prevent memory leaks.
 * @param rootGroup The THREE.Group whose children will be disposed and removed.
 */
export function disposeGroupChildren(rootGroup: Group): void {
  for (let i = rootGroup.children.length - 1; i >= 0; i--) {
    const child = rootGroup.children[i]
    rootGroup.remove(child)
    disposeObject(child)
  }
}

function disposeObject(obj: Object3D): void {
  obj.children.forEach((child) => {
    disposeObject(child)
  })

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
}

function disposeMaterial(material: Material): void {
  // Clean up custom shader properties before disposal
  // This ensures shader programs and callbacks are properly released
  // Use Reflect.deleteProperty to avoid TypeScript's delete operator restrictions
  if (hasProperty(material, 'onBeforeCompile')) {
    Reflect.deleteProperty(material, 'onBeforeCompile')
  }
  if (hasProperty(material, 'customProgramCacheKey')) {
    Reflect.deleteProperty(material, 'customProgramCacheKey')
  }

  // Clear any custom uniforms that might hold references
  // (Three.js will handle standard uniforms, but custom ones from onBeforeCompile need cleanup)
  // Note: Uniforms are stored in the shader object, not directly on material,
  // but we clear them defensively in case they're accessible
  if (hasProperty(material, 'uniforms')) {
    const uniformsValue = material.uniforms
    if (isRecord(uniformsValue)) {
      // Clear custom uniforms that we added (uSegmentStart, uSegmentEnd, uArcCenter, etc.)
      if (hasProperty(uniformsValue, 'uSegmentStart')) {
        Reflect.deleteProperty(uniformsValue, 'uSegmentStart')
      }
      if (hasProperty(uniformsValue, 'uSegmentEnd')) {
        Reflect.deleteProperty(uniformsValue, 'uSegmentEnd')
      }
      if (hasProperty(uniformsValue, 'uArcCenter')) {
        Reflect.deleteProperty(uniformsValue, 'uArcCenter')
      }
      if (hasProperty(uniformsValue, 'uArcStart')) {
        Reflect.deleteProperty(uniformsValue, 'uArcStart')
      }
      if (hasProperty(uniformsValue, 'uArcStartAngle')) {
        Reflect.deleteProperty(uniformsValue, 'uArcStartAngle')
      }
      if (hasProperty(uniformsValue, 'uArcEndAngle')) {
        Reflect.deleteProperty(uniformsValue, 'uArcEndAngle')
      }
    }
  }

  // Dispose of textures associated with the material
  // if we ever start using textures in the sketch scene
  material.dispose()
}
