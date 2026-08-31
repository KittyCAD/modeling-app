import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { ArtifactId } from '@rust/kcl-lib/bindings/ArtifactId'
import type { Operation, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'

/**
 * Whether something in the feature tree is hidden, and how to say otherwise.
 *
 * Ported from `resolveFeatureTreeVisibility` and the `hide` helpers in the
 * existing app, and the thing to understand before reading any of it is where
 * visibility *lives*: in the KCL. Hiding a sketch writes `hide(sketch001)` into
 * the file, and showing it again deletes that call. It is not an engine toggle
 * and not app state — which is why it survives a reload, travels with the file,
 * and appears in the feature tree as an operation of its own.
 *
 * So "is this hidden" is not a flag to look up. It is a question about the
 * program: does any `hide()` call in it name this artifact?
 */

/**
 * The artifact ids one operation argument refers to.
 *
 * A near-verbatim port, kept exhaustive for the reason the original gives: the
 * Rust enum tags its variants without renaming their fields, so a variant whose
 * payload is a struct carries the id one level down as `value.artifactId`, while
 * one that holds the id directly carries it as `artifact_id` on the variant. The
 * original's own comment records that reading only the nested shape made hidden
 * planes, annotations and imported geometry invisible to every caller.
 *
 * Every variant is listed so that adding one to `OpKclValue` fails to compile
 * here rather than silently dropping its id.
 */
function artifactIdsInValue(value: OpKclValue): ArtifactId[] {
  switch (value.type) {
    // The id is a field of the variant, spelled as Rust spells it.
    case 'Plane':
    case 'Face':
    case 'Segment':
    case 'GdtAnnotation':
    case 'ImportedGeometry':
      return [value.artifact_id]

    // The id belongs to a struct payload, which serialises camelCase.
    case 'Sketch':
    case 'Solid':
    case 'Helix':
      return [value.value.artifactId]

    // `hide([body001, body002])` arrives as an array of the variants above.
    case 'Array':
      return value.value.flatMap(artifactIdsInValue)

    /*
     * A tag identifier's artifact id is optional and a tag is not a hideable
     * value, so it is not collected. Object fields are not descended into for
     * the same reason: no hideable value is passed inside an object.
     */
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

    default: {
      const unhandled: never = value
      return unhandled
    }
  }
}

/** A `hide()` call, and nothing else. */
export type HideOperation = Extract<Operation, { type: 'StdLibCall' }>

const isHideCall = (operation: Operation): operation is HideOperation =>
  operation.type === 'StdLibCall' && operation.name === 'hide'

/** Which artifacts a `hide()` call names. Empty for anything else. */
export function hiddenArtifactIdsOf(operation: Operation): ArtifactId[] {
  if (!isHideCall(operation)) return []

  const value = operation.unlabeledArg?.value
  return value ? artifactIdsInValue(value) : []
}

/** Every artifact the program hides. */
export function hiddenArtifactIds(
  operations: readonly Operation[]
): Set<ArtifactId> {
  return new Set(operations.flatMap(hiddenArtifactIdsOf))
}

/** The `hide()` call that hides an artifact, if one does. */
export function hideOperationFor(
  operations: readonly Operation[],
  artifactId: ArtifactId
): HideOperation | null {
  for (const operation of operations) {
    if (!isHideCall(operation)) continue
    if (hiddenArtifactIdsOf(operation).includes(artifactId)) return operation
  }

  return null
}

/**
 * Which operations can be hidden.
 *
 * `hide` accepts solids, planes, sketches, helices, imported geometry and GD&T
 * annotations — so what belongs here is anything whose *result* is one of those.
 * A list of names rather than a derivation because an operation does not carry
 * the type of what it produced; when it does, this becomes a check against
 * `hide`'s own signature and stops needing to be maintained.
 *
 * `region` is here and is not in the existing app's version: a region evaluates
 * to a `Sketch`, so `hide(region001)` is valid, and a region is exactly the kind
 * of overlapping geometry somebody wants out of the way.
 */
const HIDEABLE_CALLS = new Set(['helix', 'region'])

export interface VisibilityState {
  /** Whether to offer an eye at all. */
  canToggle: boolean
  hidden: boolean
  /** The `hide()` call to remove, when hiding is what is in force. */
  hideOperation: HideOperation | null
}

const CANNOT_TOGGLE: VisibilityState = {
  canToggle: false,
  hidden: false,
  hideOperation: null,
}

/**
 * The artifact an operation produced.
 *
 * Matched on an *exact* code range, which is `findOperationArtifact`'s rule in
 * the existing app and the right one here: an operation and the artifact it
 * produced were written by the same call, so their ranges are the same range.
 * Anything looser — the narrowest artifact covering the offset, say — finds a
 * segment inside a sketch rather than the sketch.
 */
function artifactForOperation(
  artifacts: ArtifactMap,
  operation: Operation
): { id: string; artifact: Artifact } | null {
  if (operation.type === 'GroupEnd') return null
  const [from, to] = operation.sourceRange

  for (const [id, artifact] of artifacts) {
    if (!('codeRef' in artifact)) continue
    const range = artifact.codeRef?.range
    if (!range) continue
    if (range[0] !== from || range[1] !== to) continue

    return { id, artifact }
  }

  return null
}

/**
 * What the eye on a row should say, and whether there should be one.
 *
 * Three answers rather than two, and the third is the useful one: an operation
 * that *could* be hidden but whose artifact the last run did not produce has no
 * visibility to toggle, and offering an eye that does nothing is worse than
 * offering none.
 */
export function resolveVisibility(input: {
  operation: Operation
  operations: readonly Operation[]
  artifacts: ArtifactMap
}): VisibilityState {
  const { operation, operations, artifacts } = input

  const hideable =
    (operation.type === 'StdLibCall' && HIDEABLE_CALLS.has(operation.name)) ||
    (operation.type === 'GroupBegin' && operation.group.type === 'SketchBlock')

  if (!hideable) return CANNOT_TOGGLE

  const found = artifactForOperation(artifacts, operation)
  if (!found) return CANNOT_TOGGLE

  /*
   * A sketch block has to resolve to a sketch block. The range match is exact,
   * so this is a guard rather than a filter — but the existing app keeps it, and
   * a row offering to hide something that turned out to be a segment would write
   * KCL that does not typecheck.
   */
  if (
    operation.type === 'GroupBegin' &&
    found.artifact.type !== 'sketchBlock'
  ) {
    return CANNOT_TOGGLE
  }

  const hideOperation = hideOperationFor(operations, found.id)
  return {
    canToggle: true,
    hidden: hideOperation !== null,
    hideOperation,
  }
}
