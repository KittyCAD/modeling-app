import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'

/**
 * Returns only the objects that belong to the active sketch while preserving
 * their original ids as array indices.
 *
 * This intentionally returns a sparse array, because many sketch-solve helpers
 * rely on `objects[id]` lookups for linked points and owners.
 */
export function getCurrentSketchObjectsById(
  objects: Array<ApiObject>,
  sketchId: number
): Array<ApiObject> {
  const currentSketchObjects: Array<ApiObject> = []
  let isInCurrentSketch = false

  objects.forEach((obj, index) => {
    if (obj.kind.type === 'Sketch') {
      if (obj.id === sketchId) {
        isInCurrentSketch = true
      } else if (isInCurrentSketch && obj.id > sketchId) {
        isInCurrentSketch = false
      }
    }

    if (isInCurrentSketch) {
      currentSketchObjects[index] = obj
    }
  })

  return currentSketchObjects
}
