import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import {
  bindingContaining,
  referencePartsAt,
  regionSegmentSources,
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

/** Said when the file has no name for the solid the face belongs to. */
const NO_SOLID = 'That face belongs to a solid this file does not name.'

/**
 * What to tell somebody who has to write the reference themselves.
 *
 * Names the solid, shows the shape of the call, and quotes a segment their own
 * region already names — so the only thing left to supply is the one thing only
 * they know, which is which of those segments they just clicked.
 */
function suggestion(
  solid: string,
  region: string | null,
  context: KclReferenceContext
): string {
  const candidates =
    region && context.source
      ? regionSegmentSources(context.program, context.source, region)
      : []

  const example = candidates[0]
  return example
    ? `Sketch on an end cap, or type a reference like faceOf(${solid}, face = ${example}).`
    : `Sketch on an end cap, or type a reference of the form faceOf(${solid}, face = <segment>).`
}

export interface KclReferenceContext {
  /** The graph from the last run: what the engine drew. */
  artifacts: ArtifactMap
  /** The program being written into, which is what the reference must resolve in. */
  program: Program
  /**
   * The text that program was parsed from.
   *
   * Only for showing somebody a reference they will have to write themselves:
   * quoting their own file beats re-rendering an expression out of the AST.
   */
  source?: string
}

/** Which route produced a reference, for diagnosis and for the cutover. */
export type FaceReferenceVia =
  /** `faceOf(solid, face = END)` — a cap is a position, not a reference. */
  | 'cap'
  /** `faceOf(solid, face = region001.tags.line1)` — through the region. */
  | 'wall.regionTag'
  /** `faceOf(solid, face = triangle.line1)` — through the swept segment. */
  | 'wall.segment'

/**
 * What can be said about the face an entity is.
 *
 * Three answers, not two. "Not a face" and "a face nobody can name" are
 * different things: the first means a caller should go on and name the thing
 * itself, and the second means it must stop and say why. Collapsing them is what
 * turned "this face cannot be referred to yet" into "on is needed".
 */
export type FaceLookup =
  | { kind: 'reference'; source: string; via: FaceReferenceVia }
  | { kind: 'unavailable'; reason: string }

const unavailable = (reason: string): FaceLookup => ({
  kind: 'unavailable',
  reason,
})

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
): FaceLookup | null {
  const artifact = context.artifacts.get(entityId)
  if (!artifact) return null

  if (artifact.type === 'cap') return capReference(artifact, context)
  if (artifact.type === 'wall') return wallReference(artifact, context)

  /*
   * A face with nothing but an engine index. `faceId(solid, index = 3)` would
   * resolve to a different face the moment the model changes, and a reference
   * that silently means something else later is worse than one that was never
   * written.
   */
  if (artifact.type === 'primitiveFace') {
    return unavailable(
      'Faces of imported geometry cannot be referred to in KCL yet.'
    )
  }

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
): FaceLookup {
  const solid = solidReference(cap.sweepId, context)
  if (!solid) return unavailable(NO_SOLID)

  const end = cap.subType === 'start' ? 'START' : 'END'
  return {
    kind: 'reference',
    source: `faceOf(${solid}, face = ${end})`,
    via: 'cap',
  }
}

/**
 * A wall is named by the segment that was swept to make it.
 *
 * Which only works when the graph still says *which* segment that was. It does
 * when a sketch was swept directly: the wall's segment is one of the sketch
 * block's own, and its code range points at `l1 = line(…)` inside the block, so
 * `s.l1` names it.
 *
 * It does not when a **region** was swept, and that is not a bug here. A region
 * builds its own segments, every one of them carrying the range of the `region(…)`
 * call rather than of any line, and the graph records no edge back to the sketch
 * segment each came from. So four walls of a swept region are four artifacts
 * whose code all points at the same call, and nothing in the file distinguishes
 * them.
 *
 * Guessing was considered and rejected. The walls arrive in the sweep's surface
 * order and the region's `segments` argument is also a list, so the *i*th wall
 * could be matched to the *i*th entry — except a region is bounded by every
 * segment that closes it, not only the ones named in the argument, so the two
 * lists are different lengths as soon as a boundary is implied. A reference that
 * is right until the sketch gains a line is worse than none.
 *
 * This is the gap the Face API closes, and it is why the whole file exists.
 */
function wallReference(
  wall: Extract<Artifact, { type: 'wall' }>,
  context: KclReferenceContext
): FaceLookup {
  const solid = solidReference(wall.sweepId, context)
  if (!solid) return unavailable(NO_SOLID)

  const segment = context.artifacts.get(wall.segId)
  if (!segment || !('codeRef' in segment)) {
    return unavailable('The engine did not say which segment made that face.')
  }

  const parts = referencePartsAt(context.program, segment.codeRef.range[0])

  /*
   * A segment has a name only inside a sketch block. Anywhere else — and a
   * region's segments point at the region call — there is nothing to write, so
   * `outer` must not be used as a stand-in: it names the region, and
   * `region001.tags.region001` is not a face.
   */
  const sweep = context.artifacts.get(wall.sweepId)
  const region =
    sweep && sweep.type === 'sweep'
      ? sweptRegionName(context.program, sweep.codeRef.range[0])
      : null

  if (!parts?.inner) {
    return unavailable(
      `That face came from sweeping a region, and the artifact graph does not say which segment made it. ${suggestion(solid, region, context)}`
    )
  }

  /*
   * Through the region when the sweep consumed a named one: a region re-exposes
   * the segments it consumed as tags. Otherwise the segment reference itself,
   * which `faceOf` accepts a `Segment` for.
   */
  return region
    ? {
        kind: 'reference',
        source: `faceOf(${solid}, face = ${region}.tags.${parts.inner})`,
        via: 'wall.regionTag',
      }
    : {
        kind: 'reference',
        source: `faceOf(${solid}, face = ${parts.outer}.${parts.inner})`,
        via: 'wall.segment',
      }
}
