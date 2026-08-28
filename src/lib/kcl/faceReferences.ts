import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import {
  bindingContaining,
  referencePartsAt,
  regionNameAt,
  regionSegmentSources,
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
   * `faceOf(solid, face = faceId(solid, index = 3))` — the engine's own index.
   *
   * Last, and brittle by construction: the index is an ordering of the solid's
   * faces, so it survives nothing that reorders them. kcl-lib writes exactly
   * this for a face it cannot otherwise name, and the index is verified against
   * the engine before it is written, so it is right when written and wrong only
   * once the model has moved on.
   */
  | 'wall.faceIndex'

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
/**
 * What the engine could add, gathered when the face was clicked.
 *
 * Both are only worth having when the file cannot name the face by itself, and
 * both cost a round trip, so they are fetched at selection time and carried
 * rather than looked up here.
 */
export interface EngineFaceFacts {
  /**
   * The curve the engine says made this face.
   *
   * The same value as the graph's segment in the ordinary case — kcl-lib builds a
   * wall's segment *from* this curve — so it matters exactly where the two
   * disagree.
   */
  originCurve?: string | null
  /** The engine's index for the face, verified against it. */
  faceIndex?: number | null
}

export function faceReference(
  entityId: string,
  context: KclReferenceContext,
  engine: EngineFaceFacts = {}
): FaceLookup | null {
  const artifact = context.artifacts.get(entityId)
  if (!artifact) return null

  if (artifact.type === 'cap') return capReference(artifact, context)
  if (artifact.type === 'wall') {
    return wallReference(artifact, context, engine)
  }

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
 * A wall is named by the sketch segment that was swept to make it.
 *
 * The graph keeps that link even when the sweep went through a region, which is
 * the part I got wrong the first time: a region builds its own segments, each
 * carrying the range of the `region(…)` call, and each recording the sketch
 * segment it came from in `originalSegId`. So the chain is
 *
 *   wall → segment (in the region) → originalSegId → segment (in the sketch)
 *
 * and the region's own name comes from the declaration the region segment's code
 * sits in. That produces `region001.tags.l1`: a region re-exposes the segments it
 * consumed as tags, and this is how the existing app addresses a swept region's
 * wall too.
 *
 * `sourceSegmentId` is followed first, for a segment that is a clone of another.
 * Both links are single hops in the graph rather than anything inferred, so
 * nothing here guesses.
 */
function wallReference(
  wall: Extract<Artifact, { type: 'wall' }>,
  context: KclReferenceContext,
  engine: EngineFaceFacts
): FaceLookup {
  const solid = solidReference(wall.sweepId, context)
  if (!solid) return unavailable(NO_SOLID)

  const face =
    regionTagFor(wall.segId, context) ??
    segmentNameFor(wall.segId, context) ??
    (engine.originCurve ? segmentNameFor(engine.originCurve, context) : null)

  if (face) {
    return {
      kind: 'reference',
      source: `faceOf(${solid}, face = ${face.source})`,
      via: face.via,
    }
  }

  /*
   * Nothing in the file names this face, so fall back to the engine's index.
   *
   * Written as `faceId(solid, index = n)`, which is what kcl-lib writes for the
   * same case, and the index has been checked against the engine — it is the one
   * whose uuid is the face that was clicked. Brittle across changes to the model
   * and not brittle *now*: a reference that has to be revisited when the sketch
   * changes beats being unable to sketch on the face at all.
   */
  if (typeof engine.faceIndex === 'number') {
    return {
      kind: 'reference',
      source: `faceOf(${solid}, face = faceId(${solid}, index = ${engine.faceIndex}))`,
      via: 'wall.faceIndex',
    }
  }

  return unavailable(
    `Nothing in this file names that face, and the engine could not identify it either. ${suggestion(solid, regionNameFor(wall.segId, context), context)}`
  )
}

/**
 * `region001.tags.l1` — a segment of a region, through the region.
 *
 * Null unless the segment *is* one a region built: `originalSegId` is what says
 * so, and without it there is no region in the story.
 */
function regionTagFor(
  segmentId: string,
  context: KclReferenceContext
): { source: string; via: FaceReferenceVia } | null {
  const segment = sourceSegment(segmentId, context)
  if (!segment || segment.type !== 'segment') return null
  if (!segment.originalSegId || segment.originalSegId === segment.id)
    return null

  const region = regionNameAt(context.program, segment.codeRef.range[0])
  if (!region) return null

  const original = segmentNameFor(segment.originalSegId, context)
  if (!original) return null

  return {
    source: `${region}.tags.${original.inner}`,
    via: 'wall.regionTag',
  }
}

/** The region a segment belongs to, for saying what could not be named. */
function regionNameFor(
  segmentId: string,
  context: KclReferenceContext
): string | null {
  const segment = sourceSegment(segmentId, context)
  if (!segment || segment.type !== 'segment') return null
  return regionNameAt(context.program, segment.codeRef.range[0])
}

/**
 * Through a clone to the segment it was cloned from.
 *
 * One hop, as the graph records it: "for clones of clones, this continues to
 * point to the originating segment".
 */
function sourceSegment(segmentId: string, context: KclReferenceContext) {
  const segment = context.artifacts.get(segmentId)
  if (!segment || segment.type !== 'segment') return segment

  if (!segment.sourceSegmentId) return segment
  const source = context.artifacts.get(segment.sourceSegmentId)
  return source?.type === 'segment' ? source : segment
}

/**
 * A curve's name, but only when it has one.
 *
 * A segment is named only inside a sketch block: `s.l1`. Anywhere else — and a
 * region's own segments point at the `region(…)` call — there is nothing to
 * write, and the enclosing name must not stand in for it, because it names the
 * region and `region001.tags.region001` is not a face.
 */
function segmentNameFor(
  curveId: string,
  context: KclReferenceContext
): { source: string; inner: string; via: FaceReferenceVia } | null {
  const segment = context.artifacts.get(curveId)
  if (!segment || !('codeRef' in segment)) return null

  const parts = referencePartsAt(context.program, segment.codeRef.range[0])
  if (!parts?.inner) return null

  return {
    source: `${parts.outer}.${parts.inner}`,
    inner: parts.inner,
    via: 'wall.segment',
  }
}

/**
 * The path whose faces the engine can be asked about.
 *
 * `solid3d_get_extrusion_face_info` takes the *path* that was swept, which is
 * what kcl-lib passes it. A wall does not hold one, so it comes from the segment:
 * the curve knows the path it belongs to.
 */
export function sweptPathFor(
  entityId: string,
  context: KclReferenceContext
): string | null {
  const artifact = context.artifacts.get(entityId)
  if (artifact?.type !== 'wall') return null

  const segment = context.artifacts.get(artifact.segId)
  if (!segment || !('pathId' in segment)) return null
  // `pathId` is optional on some variants; absent means the graph cannot say.
  return segment.pathId ?? null
}
