import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import {
  type ArtifactMap,
  artifactsAtOffset,
  sourceRangeFor,
} from '@src/lib/kcl/artifacts'

/**
 * What the code and the scene have to do with each other.
 *
 * The existing app answers this as a correspondence: one entity, one range,
 * light them both. That only works because it is asked in one direction. Every
 * caller of its `setHighlightRange` is scene-side — the engine's hover
 * subscription, the sketch scene, the AST debug panel — and there is no editor
 * mousemove handler anywhere in it. The hard direction was never asked.
 *
 * It is not a correspondence. A `sketch` block's line becomes a wall, four
 * edges and a share of a cap; an `extrude` call makes fourteen faces and names
 * none of them; a `subtract` *removes* the two bodies its arguments point at; a
 * region has no code at all until somebody writes it; `XY` has none and never
 * needs any. The relation is many-to-many, partial at both ends, and — the part
 * that matters — its edges are of different *kinds*.
 *
 * So the question is not "which code is this entity". That has no answer. It is
 * **what part of the program is responsible for this, and how** — which does,
 * and the how is a small closed list this codebase had already found in pieces:
 * `sourceRangeFor`'s walk is `made`, kcl-lib's `consumed` flag is `consumed`,
 * `faceReference`'s `unavailable` is one of the absences below.
 *
 * Pure, and over the artifact graph alone. No services, no AST, no DOM: the
 * graph is the model the draw commands were generated from, so it already knows
 * everything asked here.
 */

/**
 * How a thing is related to the thing you pointed at.
 *
 * Four, and the set is the design. Rendering the answer flat is what makes a
 * fourteen-face highlight useless; rendering it by role is what makes the
 * fan-out the point. The existing app half-found this — its highlight extension
 * has two decorations so that index 0 draws brighter than the rest — without
 * ever saying what the difference meant.
 */
export type ProvenanceRole =
  /** The call that made it, or the expression that is it. */
  | 'primary'
  /** One step back: where its shape came from, which is not what made it. */
  | 'origin'
  /** One step forward: what it produced. */
  | 'effect'
  /** Used up. Named by the code, and no longer in the scene because of it. */
  | 'consumed'

export interface RangeMark {
  range: SourceRange
  role: ProvenanceRole
}

export interface EntityMark {
  id: string
  role: ProvenanceRole
}

/**
 * Why the answer is empty, when it is.
 *
 * The most valuable case, and the one the existing app cannot express: it lights
 * nothing and you conclude the app is broken. Each of these is a different true
 * statement, and each has something worth saying to the user.
 */
export type Absence =
  /**
   * The scene has it and the graph does not.
   *
   * A region — which does not exist until it is written — or a default plane,
   * or a pick against a run that has since been replaced. Whoever asks can go on
   * to say how it *would* be named: `regionExpression` and `planeExpression`
   * both already answer that, from facts this module does not have.
   */
  | 'unknownToTheGraph'
  /**
   * In the graph, but nothing in the file wrote it.
   *
   * Imported geometry, or a face whose whole ancestry is code-less. There is
   * nothing to point at and nothing that would make one.
   */
  | 'noCodeInAncestry'
  /**
   * Code that drew nothing.
   *
   * A parameter, a comment, a variable holding a number. Ordinary, and worth
   * distinguishing from a failure: highlighting nothing here is correct.
   */
  | 'drewNothing'

export interface Provenance {
  /** Where to decorate in the source. */
  ranges: readonly RangeMark[]
  /** What to light in the scene. */
  entities: readonly EntityMark[]
  /** Set only when both sides came back empty. */
  absence: Absence | null
}

/**
 * What made a thing, for an artifact that carries no code of its own.
 *
 * Five variants have no `codeRef` and kcl-lib says why in the type itself:
 * *"This is for the sketch-on-face plane, not for the wall itself. Traverse to
 * the extrude and/or segment to get the wall's code_ref."* The extrude is the
 * `primary` — it is the call that brought the wall into being.
 *
 * Note this is the opposite order from `sourceRangeFor`, deliberately. That
 * function answers "what would I edit", so it prefers the segment; this answers
 * "what is responsible", so it prefers the sweep. Two questions, two walks, and
 * conflating them is how a highlight ends up pointing at a line when the user
 * asked about a body.
 */
const MADE_BY: Partial<Record<Artifact['type'], readonly string[]>> = {
  wall: ['sweepId'],
  cap: ['sweepId'],
  sweepEdge: ['sweepId'],
  edgeCutEdge: ['edgeCutId'],
  solid2d: ['pathId'],
  primitiveFace: ['solidId'],
  primitiveEdge: ['solidId'],
}

/**
 * Where a thing's shape came from, which is a different question from what made
 * it.
 *
 * A wall is *made by* its extrude and *comes from* its segment. Both are true
 * and both are worth showing, which is the entire reason roles exist rather than
 * a single "related" list.
 */
const CAME_FROM: Partial<Record<Artifact['type'], readonly string[]>> = {
  wall: ['segId'],
  sweepEdge: ['segId'],
  sweep: ['pathId', 'sourceSweepId', 'trajectoryId'],
  path: ['planeId', 'originPathId'],
  segment: ['originalSegId', 'sourceSegmentId'],
  pattern: ['sourceId'],
  helix: ['axisId'],
  startSketchOnFace: ['faceId'],
  startSketchOnPlane: ['planeId'],
  planeOfFace: ['faceId'],
  sketchBlock: ['planeId'],
}

/**
 * Inputs a call uses up.
 *
 * The direction the existing app has no word for, and the one the question
 * "*one cursor position may correspond to destroyed geometry*" is about. A
 * `subtract` names two bodies and the scene has neither afterwards, so there is
 * nothing to light — but the *code* that defined them is still there, and saying
 * "this call ate the thing defined on line 3" is the whole answer.
 *
 * `consumedEdgeId` is kcl-lib's own name for what a chamfer does to an edge.
 */
const EATS: Partial<Record<Artifact['type'], readonly string[]>> = {
  compositeSolid: ['solidIds', 'toolIds'],
  edgeCut: ['consumedEdgeId'],
}

/** What a thing produced. */
const MAKES: Partial<Record<Artifact['type'], readonly string[]>> = {
  sweep: ['surfaceIds', 'edgeIds'],
  path: ['segIds', 'sweepId', 'solid2dId'],
  segment: ['edgeIds', 'surfaceId', 'edgeCutId'],
  pattern: ['copyIds', 'copyFaceIds', 'copyEdgeIds'],
  edgeCut: ['edgeIds', 'surfaceId'],
  plane: ['pathIds'],
  sketchBlock: ['pathId'],
}

/** Ids behind one field, whether it holds one or many. */
function idsAt(artifact: Artifact, field: string): readonly string[] {
  const value = (artifact as unknown as Record<string, unknown>)[field]
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((id) => typeof id === 'string')
  return []
}

function follow(
  artifacts: ArtifactMap,
  artifact: Artifact,
  table: Partial<Record<Artifact['type'], readonly string[]>>
): readonly string[] {
  const found: string[] = []
  for (const field of table[artifact.type] ?? []) {
    for (const id of idsAt(artifact, field)) {
      if (id !== artifact.id && artifacts.has(id) && !found.includes(id)) {
        found.push(id)
      }
    }
  }
  return found
}

const ownRange = (artifact: Artifact): SourceRange | null =>
  'codeRef' in artifact ? artifact.codeRef.range : null

/**
 * The code for a related artifact.
 *
 * Its own if it has some, and otherwise whatever the ordinary walk finds — by
 * then we are one step away from the thing being asked about, and the
 * specificity order that selection wants is the right one for a supporting mark.
 */
const codeOf = (artifacts: ArtifactMap, id: string): SourceRange | null => {
  const artifact = artifacts.get(id)
  if (!artifact) return null
  return ownRange(artifact) ?? sourceRangeFor(artifacts, id)
}

/** Strongest role wins when the same thing is reached twice. */
const RANK: readonly ProvenanceRole[] = [
  'primary',
  'origin',
  'consumed',
  'effect',
]

const sameRange = (a: SourceRange, b: SourceRange) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/**
 * Collects marks, keeping the strongest role for anything reached twice and
 * emitting them in role order.
 *
 * Ordered because the surfaces need it: a decoration list wants the primary
 * first so it can draw it differently, and a stable order is what makes the
 * whole thing testable.
 */
function marks<Key, Mark extends { role: ProvenanceRole }>(
  same: (a: Key, b: Key) => boolean,
  make: (key: Key, role: ProvenanceRole) => Mark
) {
  const held: { key: Key; role: ProvenanceRole }[] = []

  return {
    add(key: Key | null | undefined, role: ProvenanceRole) {
      if (key === null || key === undefined) return

      const existing = held.find((entry) => same(entry.key, key))
      if (!existing) {
        held.push({ key, role })
        return
      }
      if (RANK.indexOf(role) < RANK.indexOf(existing.role)) existing.role = role
    },
    all(): Mark[] {
      return [...held]
        .sort((a, b) => RANK.indexOf(a.role) - RANK.indexOf(b.role))
        .map((entry) => make(entry.key, entry.role))
    },
  }
}

/**
 * What the program has to do with a thing in the scene.
 *
 * The scene-to-code direction, asked when a pointer is over geometry. The thing
 * pointed at is *not* in the answer: whoever asked is already showing it, and
 * the useful part is everything else.
 *
 * A wall answers with two ranges — the extrude that raised it as `primary`, the
 * line it was swept from as `origin` — which is the case that makes the whole
 * point. There is no single right range, there never was, and picking one is why
 * clicking a face in the existing app sometimes lands on a line that looks
 * unrelated.
 */
export function provenanceOf(
  artifacts: ArtifactMap,
  entityId: string
): Provenance {
  const artifact = artifacts.get(entityId)
  if (!artifact) {
    return { ranges: [], entities: [], absence: 'unknownToTheGraph' }
  }

  const ranges = marks<SourceRange, RangeMark>(sameRange, (range, role) => ({
    range,
    role,
  }))
  const entities = marks<string, EntityMark>(
    (a, b) => a === b,
    (id, role) => ({ id, role })
  )

  const own = ownRange(artifact)
  if (own) ranges.add(own, 'primary')

  /*
   * With no code of its own, the thing that made it takes the primary role. The
   * wall's `faceCodeRef` is not a candidate: kcl-lib says in the type that it
   * describes the sketch-on-face plane rather than the wall.
   */
  for (const id of follow(artifacts, artifact, MADE_BY)) {
    ranges.add(codeOf(artifacts, id), own ? 'origin' : 'primary')
  }

  for (const id of follow(artifacts, artifact, CAME_FROM)) {
    /*
     * kcl-lib's own flag decides the role. A path that has been swept is
     * consumed and is not in the scene any more, so pointing at it as an origin
     * would be pointing at something that is not there.
     */
    const target = artifacts.get(id)
    const eaten = !!target && 'consumed' in target && target.consumed === true
    ranges.add(codeOf(artifacts, id), eaten ? 'consumed' : 'origin')
    if (!eaten) entities.add(id, 'origin')
  }

  for (const id of follow(artifacts, artifact, EATS)) {
    ranges.add(codeOf(artifacts, id), 'consumed')
  }

  for (const id of follow(artifacts, artifact, MAKES)) {
    entities.add(id, 'effect')
  }

  const found = { ranges: ranges.all(), entities: entities.all() }
  return {
    ...found,
    absence: found.ranges.length === 0 ? 'noCodeInAncestry' : null,
  }
}

/**
 * What a place in the file has to do with the scene.
 *
 * The direction the existing app never implemented, and the one where the
 * fan-out is the answer rather than a problem: an offset inside an `extrude`
 * call lights every face the call produced, which is the app saying *this is
 * what this line does*.
 *
 * The primary range comes back too, unlike the entity in the other direction —
 * the caller had an offset, not a range, and the range is what a decoration
 * needs.
 */
export function provenanceAt(
  artifacts: ArtifactMap,
  offset: number
): Provenance {
  const covering = artifactsAtOffset(artifacts, offset)
  if (covering.length === 0) {
    return { ranges: [], entities: [], absence: 'drewNothing' }
  }

  /*
   * Everything sharing the narrowest range, not merely the first of them. One
   * call can produce several artifacts at once — a sweep and the composite solid
   * it joins into — and they are equally what the code says.
   */
  const narrowest = covering[0].range
  const here = covering.filter((found) => sameRange(found.range, narrowest))

  const ranges = marks<SourceRange, RangeMark>(sameRange, (range, role) => ({
    range,
    role,
  }))
  const entities = marks<string, EntityMark>(
    (a, b) => a === b,
    (id, role) => ({ id, role })
  )

  ranges.add(narrowest, 'primary')

  for (const { id, artifact } of here) {
    /*
     * Only what is still there. A consumed path is named by this code and is not
     * in the scene, so lighting it would ask the renderer for something that no
     * longer exists.
     */
    const eaten = 'consumed' in artifact && artifact.consumed === true
    if (!eaten) entities.add(id, 'primary')

    for (const related of follow(artifacts, artifact, MAKES)) {
      entities.add(related, 'effect')
    }

    for (const related of follow(artifacts, artifact, CAME_FROM)) {
      const target = artifacts.get(related)
      const gone = !!target && 'consumed' in target && target.consumed === true
      ranges.add(codeOf(artifacts, related), gone ? 'consumed' : 'origin')
      if (!gone) entities.add(related, 'origin')
    }

    for (const related of follow(artifacts, artifact, EATS)) {
      ranges.add(codeOf(artifacts, related), 'consumed')
    }
  }

  const found = { ranges: ranges.all(), entities: entities.all() }
  return {
    ...found,
    absence: found.entities.length === 0 ? 'drewNothing' : null,
  }
}
