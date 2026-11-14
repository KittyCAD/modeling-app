import { EdgeTargetType } from '@src/clientSideScene/localRenderer/EdgeRenderer'
import { float, uint, vec3 } from 'three/tsl'
import { type Node } from 'three/webgpu'

// The edge selection "growth" shaders need to know whether something is an
// edge. You can store a start/stop ID when assigning IDs to edges, and then in
// the shader, test whether an ID is in that range. But that ended up with more
// code complexity and data being passed around. The bit shifting math is
// obtuse but at least hidden away in this file and just exposes is() functions

// Store ID in the last 22 bits, type in the first 2
export const SELECTION_ID_TYPE_SHIFT = 22
export const SELECTION_ID_MASK = (1 << SELECTION_ID_TYPE_SHIFT) - 1

export function selectionTypeTag(type: EdgeTargetType) {
  return (type + 1) << SELECTION_ID_TYPE_SHIFT
}

export function selectionTargetId(packedId: number) {
  return packedId & SELECTION_ID_MASK
}

// These are used in shader code so use tsl primitives
export const getSelectionTypeFromId = (id: Node<'uint'>) =>
  id.shiftRight(uint(SELECTION_ID_TYPE_SHIFT))

export const isBodyEdge = (id: Node<'uint'>) =>
  getSelectionTypeFromId(id).equal(uint(EdgeTargetType.BodyEdge + 1))

export const isSketchLine = (id: Node<'uint'>) =>
  getSelectionTypeFromId(id).equal(uint(EdgeTargetType.SketchLine + 1))

export const encodeId = (id: Node<'uint'>) => {
  const byte = (shift: number) =>
    float(id.shiftRight(uint(shift)).bitAnd(uint(255))).div(255)
  return vec3(byte(0), byte(8), byte(16))
}
