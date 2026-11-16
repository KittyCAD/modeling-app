import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SourceRange } from '@src/lang/wasm'
import type { CorrespondenceRelation } from '@src/lang/std/correspondence'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import { rangesOverlap } from '@src/lang/sourceRange'

/** Query native source references directly; solver IDs are never interpreted as engine artifact IDs. */
export function createSketchCorrespondenceQuery(
  objects: ApiObject[],
  sketchId: number
) {
  const current = getCurrentSketchObjectsById(objects, sketchId)
  const relationshipsFor = (
    id: number
  ): { range: SourceRange; relation: CorrespondenceRelation }[] => {
    const object = current[id]
    if (!object || object.kind.type === 'Sketch') return []
    return object.source.type === 'Simple'
      ? [{ range: object.source.range, relation: 'defined-by' }]
      : object.source.ranges.map(([range]) => ({
          range,
          relation: 'derived-from',
        }))
  }
  return {
    relationshipsFor,
    sourcesFor: (id: number) => relationshipsFor(id).map((item) => item.range),
    targetsFor: (
      range: SourceRange,
      relations?: readonly CorrespondenceRelation[]
    ) =>
      current.flatMap((object) =>
        relationshipsFor(object.id).some(
          (source) =>
            (!relations || relations.includes(source.relation)) &&
            rangesOverlap(range, source.range)
        )
          ? [object.id]
          : []
      ),
  }
}
