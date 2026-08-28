import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import {
  bindingContaining,
  referenceAt,
  referencePartsAt,
  sweptRegionName,
} from '@src/lib/kclStdlib/program'

/**
 * How a face of a swept solid is named in KCL.
 *
 * This file exists to be the *only* one that knows, because what it knows is
 * strange and temporary. A side face has no name of its own: it is referred to
 * through the sketch segment that was swept to make it, or through the region
 * that consumed that segment. An end cap is referred to differently again, by a
 * position rather than a reference. And an imported face has nothing but an
 * engine index, which is brittle enough that we would rather say we cannot name
 * it than write it down.
 *
 * None of that is a fact about faces. It is a fact about the current engine
 * plumbing, and a Face API that gives stable topological references is being
 * built to replace it — at which point this file changes and nothing else has to.
 * That is the whole point of it: the weirdness has one address.
 *
 * The rules and the expressions they produce are kcl-lib's, taken from the same
 * decisions its own frontend makes when it puts a sketch on a face. Where it and
 * this disagree, it is right.
 */

export interface KclReferenceContext {
  /** The graph from the last run: what the engine drew. */
  artifacts: ArtifactMap
  /** The program being written into, which is what the reference must resolve in. */
  program: Program
}

/** Which route produced a reference, for diagnosis and for the cutover. */
export type FaceReferenceVia =
  /** `faceOf(solid, face = END)` — a cap is a position, not a reference. */
  | 'cap'
  /** `faceOf(solid, face = region001.tags.line1)` — through the region. */
  | 'wall.regionTag'
  /** `faceOf(solid, face = triangle.line1)` — through the swept segment. */
  | 'wall.segment'

export interface FaceReference {
  /** KCL source that evaluates to the face. */
  source: string
  via: FaceReferenceVia
}

/**
 * The solid a swept surface belongs to.
 *
 * The sweep's own code is the call that made it, and the binding holding that
 * call is the solid's name. This is the `resolveBodySelectors` case in miniature,
 * and it is separate because a face reference needs it too: every form starts
 * `faceOf(<solid>, …)`.
 *
 * A sweep that produced several solids would need indexing — `extrude` returns a
 * list — and nothing here does that yet, because the graph does not say which
 * output a surface came from. A part built from one region at a time is
 * unaffected, which is every part this app can currently make.
 */
export function solidReference(
  sweepId: string,
  context: KclReferenceContext
): string | null {
  const sweep = context.artifacts.get(sweepId)
  if (!sweep || sweep.type !== 'sweep') return null

  return (
    bindingContaining(context.program, sweep.codeRef.range[0])?.name ?? null
  )
}

/**
 * How to refer to the face an entity is, if it is one.
 *
 * Null for anything that is not a face of a sweep — a segment, a plane, a solid,
 * an edge. Those have names of their own and are read straight out of the
 * program; only faces need this.
 */
export function faceReference(
  entityId: string,
  context: KclReferenceContext
): FaceReference | null {
  const artifact = context.artifacts.get(entityId)
  if (!artifact) return null

  if (artifact.type === 'cap') return capReference(artifact, context)
  if (artifact.type === 'wall') return wallReference(artifact, context)

  return null
}

/**
 * A cap is named by which end of the sweep it is.
 *
 * `START` and `END` rather than a tag, which is what kcl-lib writes today — with
 * its own note that this should become an explicit `tagStart`/`tagEnd` reference.
 * Writing the tag instead would mean editing the sweep call to add one, and doing
 * that before kcl-lib agrees would put two spellings of the same thing in one
 * file.
 */
function capReference(
  cap: Extract<Artifact, { type: 'cap' }>,
  context: KclReferenceContext
): FaceReference | null {
  const solid = solidReference(cap.sweepId, context)
  if (!solid) return null

  const end = cap.subType === 'start' ? 'START' : 'END'
  return { source: `faceOf(${solid}, face = ${end})`, via: 'cap' }
}

/**
 * A wall is named by the segment that was swept to make it.
 *
 * Through the region when there is one: a region consumes the segments it is
 * built from and re-exposes them as tags, so `region001.tags.line1` is how a
 * swept region's wall is addressed. Without a named region — the segment swept
 * directly — the segment reference itself is the answer, and `faceOf` accepts a
 * `Segment` for exactly this.
 */
function wallReference(
  wall: Extract<Artifact, { type: 'wall' }>,
  context: KclReferenceContext
): FaceReference | null {
  const solid = solidReference(wall.sweepId, context)
  if (!solid) return null

  const segment = context.artifacts.get(wall.segId)
  if (!segment || !('codeRef' in segment)) return null

  const offset = segment.codeRef.range[0]
  const sweep = context.artifacts.get(wall.sweepId)
  const region =
    sweep && sweep.type === 'sweep'
      ? sweptRegionName(context.program, sweep.codeRef.range[0])
      : null

  if (region) {
    const parts = referencePartsAt(context.program, offset)
    const name = parts?.inner ?? parts?.outer
    if (!name) return null

    return {
      source: `faceOf(${solid}, face = ${region}.tags.${name})`,
      via: 'wall.regionTag',
    }
  }

  const reference = referenceAt(context.program, offset)
  if (!reference) return null

  return {
    source: `faceOf(${solid}, face = ${reference})`,
    via: 'wall.segment',
  }
}

/**
 * Why a face could not be named, in words a user can act on.
 *
 * Only for the faces this cannot reach: an imported body's face, or a primitive
 * with nothing but an engine index. Saying so beats writing `faceId(solid, index
 * = 3)`, which resolves to a different face the moment the model changes — a
 * reference that silently means something else later is worse than one that was
 * never written.
 */
export function faceReferenceUnavailable(
  entityId: string,
  context: KclReferenceContext
): string | null {
  const artifact = context.artifacts.get(entityId)
  if (!artifact) return 'The engine does not report that face yet.'

  if (artifact.type === 'cap' || artifact.type === 'wall') {
    return 'That face belongs to a solid this file does not name.'
  }

  if (
    artifact.type === 'primitiveFace' ||
    artifact.type === 'importedGeometry'
  ) {
    return 'Faces of imported geometry cannot be referred to stably yet.'
  }

  return null
}
