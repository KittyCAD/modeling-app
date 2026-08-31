import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'

/**
 * The artifact graph: what the engine drew, and which code drew it.
 *
 * kcl-lib hands this back with every successful execution and it has been
 * carried as an opaque value until now. It is what turns "you clicked entity
 * 9f3c…" into "you clicked the line on line 4", which is the whole of selection.
 *
 * Kept as plain functions over a map rather than a class, because that is what it
 * is: the graph is data from the executor, replaced wholesale on every run.
 */

export type ArtifactMap = ReadonlyMap<string, Artifact>

/**
 * Whether a source range points into the file on screen.
 *
 * The third element is the module id, and the top-level module is zero. Worth a
 * named function because kcl-lib's own doc comment for the type calls it
 * "whether the source range belongs to the 'main' file", which reads as a
 * boolean and is the opposite of what the value means — the Rust builds it from
 * `module_id.as_usize()`, and `ModuleId::is_top_level` is `== 0`.
 */
export const isTopLevel = (range: SourceRange): boolean => range[2] === 0

/** What kcl-lib serialises the graph as. */
interface RustArtifactGraph {
  map?: Record<string, Artifact | null>
}

/**
 * Read the graph out of an execution outcome.
 *
 * Total, and empty on anything unexpected: a graph we cannot read means
 * selection cannot name what was clicked, which is a worse experience and not a
 * broken app. An execution that failed still returns the artifacts it managed to
 * build, so this is called on both paths.
 */
export function artifactsFrom(graph: unknown): ArtifactMap {
  const source = (graph as RustArtifactGraph | null)?.map
  if (!source || typeof source !== 'object') return new Map()

  const artifacts = new Map<string, Artifact>()
  for (const [id, artifact] of Object.entries(source)) {
    if (artifact) artifacts.set(id, artifact)
  }
  return artifacts
}

/**
 * Fields that lead from an artifact with no code of its own to one that has some.
 *
 * Five variants carry no `codeRef` — `wall`, `cap`, `sweepEdge`, `solid2d` and
 * `edgeCutEdge` — and kcl-lib says so in the type: *"This is for the
 * sketch-on-face plane, not for the wall itself. Traverse to the extrude and/or
 * segment to get the wall's code_ref."*
 *
 * The order is the answer's specificity, not the graph's shape. Clicking a wall
 * should take you to the line that drew it before the extrude that raised it,
 * because the line is what you would edit.
 */
const REFERENCE_FIELDS = [
  'segId',
  'pathId',
  'sweepId',
  'surfaceId',
  'faceId',
  'consumedEdgeId',
] as const

const codeRefOf = (artifact: Artifact): SourceRange | null =>
  'codeRef' in artifact ? artifact.codeRef.range : null

/**
 * Where in the source an entity came from.
 *
 * Follows the graph when the artifact has no code of its own, depth first in
 * order of specificity, with a visited set — the graph has cycles (a wall names
 * its sweep, a sweep names its surfaces) and a naive walk would not return.
 */
export function sourceRangeFor(
  artifacts: ArtifactMap,
  entityId: string
): SourceRange | null {
  const visited = new Set<string>()

  const walk = (id: string): SourceRange | null => {
    if (visited.has(id)) return null
    visited.add(id)

    const artifact = artifacts.get(id)
    if (!artifact) return null

    const own = codeRefOf(artifact)
    if (own) return own

    const record = artifact as unknown as Record<string, unknown>
    for (const field of REFERENCE_FIELDS) {
      const value = record[field]
      if (typeof value !== 'string') continue

      const found = walk(value)
      if (found) return found
    }

    return null
  }

  return walk(entityId)
}

/** What kind of thing was clicked, for filtering a selection by type. */
export function artifactKindFor(
  artifacts: ArtifactMap,
  entityId: string
): Artifact['type'] | null {
  return artifacts.get(entityId)?.type ?? null
}

/**
 * The artifacts whose code covers an offset in the source.
 *
 * The other direction, for reflecting a cursor as a selection. Narrowest first,
 * because a click at a point inside an extrude that contains a line means the
 * line — the same rule as the source-range walk, from the other end.
 */
export function artifactsAtOffset(
  artifacts: ArtifactMap,
  offset: number
): readonly { id: string; artifact: Artifact; range: SourceRange }[] {
  const found: { id: string; artifact: Artifact; range: SourceRange }[] = []

  for (const [id, artifact] of artifacts) {
    const range = codeRefOf(artifact)
    if (!range) continue

    const [start, end] = range
    if (offset < start || offset > end) continue
    found.push({ id, artifact, range })
  }

  return found.sort(
    (a, b) => a.range[1] - a.range[0] - (b.range[1] - b.range[0])
  )
}
