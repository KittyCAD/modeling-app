import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { ArtifactId } from '@rust/kcl-lib/bindings/ArtifactId'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'

/**
 * Whether the last run put anything on screen.
 *
 * Asked so the default planes can appear when there is nothing else to look at,
 * and it is worth saying plainly why this is answerable at all: **the app cannot
 * ask the renderer.** The engine is in another process, reports no inventory of
 * its scene, and a bounds query would be a round trip that answers after the
 * fact.
 *
 * It does not need to. The artifact graph is not an estimate of what the engine
 * drew — it is the model the draw commands were generated *from*, by the same
 * execution, in the same pass. The only way it can disagree with the picture is
 * if the engine failed to obey, which is a bug rather than a state to design
 * around.
 *
 * So "is the scene empty" becomes a definition, and this is it: no artifact of a
 * kind that draws, that has not been consumed by a later operation, and that is
 * not hidden. The existing app uses `artifactGraph.size > 0`, which is wrong at
 * both ends — it counts named views and bare planes, which draw nothing, and it
 * ignores `hide()` entirely, so a file whose only solid is hidden renders an
 * empty scene and is called populated.
 */

/**
 * The artifact kinds that put marks on screen.
 *
 * Everything else is bookkeeping: a `plane` is the surface a sketch was started
 * on (the default ones are created hidden), `startSketchOn*` and `sketchBlock*`
 * describe where code came from, and a `namedView` is a saved camera.
 */
const DRAWING_KINDS: ReadonlySet<Artifact['type']> = new Set([
  'path',
  'segment',
  'solid2d',
  'sweep',
  'wall',
  'cap',
  'sweepEdge',
  'edgeCut',
  'edgeCutEdge',
  'helix',
  'importedGeometry',
  'gdtAnnotation',
  'compositeSolid',
  'pattern',
  'primitiveFace',
  'primitiveEdge',
])

/** Artifacts that carry kcl-lib's own "used up by a later operation" flag. */
const consumed = (artifact: Artifact): boolean =>
  'consumed' in artifact && artifact.consumed === true

/**
 * The parts of an artifact, for spreading a `hide()` down to them.
 *
 * `hide(body001)` names one artifact — the sweep, or the composite solid — and
 * the walls, caps and edges that make it up are separate artifacts that go with
 * it. Downwards rather than upwards, because that is the direction the KCL says:
 * you hide a body, not a face of one.
 */
function partsOf(artifact: Artifact): readonly ArtifactId[] {
  switch (artifact.type) {
    case 'compositeSolid':
      return [...artifact.solidIds, ...artifact.toolIds]
    case 'sweep':
      return [...artifact.surfaceIds, ...artifact.edgeIds]
    case 'path':
      return artifact.segIds
    case 'wall':
    case 'cap':
      return artifact.edgeCutEdgeIds
    default:
      return []
  }
}

/**
 * Everything a set of hidden artifacts takes with it.
 *
 * Breadth-first over the parts, guarded against a graph that points at itself:
 * `compositeSolidId` can nest, and a malformed graph is a normal thing to be
 * handed after a failed run.
 */
export function hiddenClosure(
  artifacts: ArtifactMap,
  hidden: ReadonlySet<ArtifactId>
): ReadonlySet<ArtifactId> {
  const found = new Set<ArtifactId>(hidden)
  const pending = [...hidden]

  while (pending.length > 0) {
    const id = pending.pop()
    if (id === undefined) continue

    const artifact = artifacts.get(id)
    if (!artifact) continue

    for (const part of partsOf(artifact)) {
      if (found.has(part)) continue
      found.add(part)
      pending.push(part)
    }
  }

  return found
}

/**
 * Whether the scene has nothing in it to look at.
 *
 * Three cases fall out rather than needing rules of their own. A **failed** run
 * still reports what it got done, so a program that errored after extruding is
 * correctly populated. **Nothing executed** means no artifacts *and* no default
 * planes — kcl-lib creates those during a run — so there is nothing to decide.
 * And a file that hides everything it makes is empty again, which is the case
 * the existing app gets wrong.
 */
export function sceneIsEmpty(
  artifacts: ArtifactMap,
  hidden: ReadonlySet<ArtifactId> = new Set()
): boolean {
  // The overwhelmingly common case, and it needs none of the rest: an empty
  // graph is an empty scene.
  if (artifacts.size === 0) return true

  const invisible = hiddenClosure(artifacts, hidden)

  for (const [id, artifact] of artifacts) {
    if (!DRAWING_KINDS.has(artifact.type)) continue
    if (invisible.has(id)) continue
    /*
     * Consumed geometry is inside whatever consumed it. A profile that has been
     * swept is not drawn beside the solid it made, so hiding that solid should
     * bring the planes back rather than leaving the sketch behind as evidence
     * that something is still there.
     */
    if (consumed(artifact)) continue

    return false
  }

  return true
}
