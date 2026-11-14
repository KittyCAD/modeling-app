import type { EntityReference } from '@kittycad/lib'

/**
 * Single id carried by an entity reference, when it has one.
 * Edges and vertices are not a single artifact: an edge id here is only the
 * first side face, which is enough to find related face artifacts.
 */
export function getEntityRefId(entityRef: EntityReference): string | undefined {
  switch (entityRef.type) {
    case 'annotation':
      return entityRef.annotation_id
    case 'plane':
      return entityRef.plane_id
    case 'face':
      return entityRef.face_id
    case 'solid2d':
      return entityRef.solid2d_id
    case 'solid3d':
      return entityRef.solid3d_id
    case 'helix':
      return entityRef.helix_id
    case 'solid2d_edge':
      return entityRef.edge_id
    case 'segment':
      return entityRef.segment_id
    case 'region':
      return entityRef.region_id
    case 'edge':
      return entityRef.side_faces?.[0]
    case 'vertex':
    default:
      return undefined
  }
}

function sortedIds(ids: readonly string[] | undefined): string {
  return ids?.toSorted().join(',') || ''
}

/**
 * Stable identity for an entity reference. Face order does not matter for
 * edges and vertices: the engine may return the same topology in either order.
 */
export function entityReferenceKey(entityRef: EntityReference): string | null {
  switch (entityRef.type) {
    case 'annotation':
      return `annotation:${entityRef.annotation_id}`
    case 'plane':
      return `plane:${entityRef.plane_id}`
    case 'face':
      return `face:${entityRef.face_id}`
    case 'solid2d':
      return `solid2d:${entityRef.solid2d_id}`
    case 'solid3d':
      return `solid3d:${entityRef.solid3d_id}`
    case 'helix':
      return `helix:${entityRef.helix_id}`
    case 'solid2d_edge':
      return `solid2d_edge:${entityRef.edge_id}`
    case 'segment':
      return `segment:${entityRef.path_id}:${entityRef.segment_id}`
    case 'region':
      return `region:${entityRef.region_id}`
    case 'edge':
      return `edge:${sortedIds(entityRef.side_faces)}:${sortedIds(entityRef.end_faces)}:${entityRef.index ?? ''}`
    case 'vertex':
      return `vertex:${sortedIds(entityRef.side_faces)}:${entityRef.index ?? ''}`
    default:
      return null
  }
}
