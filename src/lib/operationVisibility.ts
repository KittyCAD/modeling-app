import type { Operation, OpKclValue } from '@rust/kcl-lib/bindings/Operation'

export type HideOperation = Operation & { type: 'StdLibCall'; name: 'hide' }

/**
 * Collects the artifact ids an operation value refers to.
 *
 * `OpKclValue` serializes an artifact id in two different shapes, because the
 * Rust enum tags its variants without renaming their fields: variants whose
 * payload is a struct carry the id one level down as `value.artifactId`, while
 * variants that hold the id directly carry it as `artifact_id` on the variant
 * itself. Reading only the nested shape made hidden planes, GD&T annotations and
 * imported geometry invisible to every caller below.
 *
 * Every variant is listed so that adding one to `OpKclValue` fails lint
 * here rather than silently dropping its id.
 */
function artifactIdsInOpValue(value: OpKclValue): string[] {
  switch (value.type) {
    // The id is a field of the variant, spelled as Rust spells it. `hide()`
    // accepts only Plane, GdtAnnotation and ImportedGeometry of these; Face and
    // Segment are read too, because what this function depends on is the
    // serialized shape rather than any one caller's accepted types.
    case 'Plane':
    case 'Face':
    case 'Segment':
    case 'GdtAnnotation':
    case 'ImportedGeometry':
      return [value.artifact_id]

    // The id belongs to a struct payload, which serializes camelCase.
    case 'Sketch':
    case 'Solid':
    case 'Helix':
      return [value.value.artifactId]

    // `hide([body001, body002])` arrives as an array of the variants above.
    case 'Array':
      return value.value.flatMap(artifactIdsInOpValue)

    // A tag identifier's artifact id is optional and a tag is not a hideable
    // value, so it is not collected. Object fields are not descended into for
    // the same reason: no hideable value is passed inside an object.
    case 'TagIdentifier':
    case 'TagDeclarator':
    case 'Object':
    case 'Uuid':
    case 'Bool':
    case 'Number':
    case 'String':
    case 'Enum':
    case 'SketchVar':
    case 'CameraView':
    case 'Function':
    case 'Module':
    case 'Type':
    case 'KclNone':
    case 'BoundedEdge':
      return []
  }
}

export function getHideOperationArtifactIds(op: Operation): string[] {
  if (!(op.type === 'StdLibCall' && op.name === 'hide')) {
    return []
  }

  const value = op.unlabeledArg?.value
  if (!value) {
    return []
  }

  return artifactIdsInOpValue(value)
}

/** Returns every artifact id the used in the program as an argument to `hide()`*/
export function hiddenArtifactIdsFromOperations(
  operations: Operation[]
): Set<string> {
  return new Set(operations.flatMap(getHideOperationArtifactIds))
}

export function getHideOpByArtifactId(
  ops: Operation[],
  searchId: string
): HideOperation | undefined {
  return ops.find(
    (op): op is HideOperation =>
      op.type === 'StdLibCall' &&
      op.name === 'hide' &&
      getHideOperationArtifactIds(op).includes(searchId)
  )
}
