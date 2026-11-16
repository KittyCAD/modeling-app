import { computed, signal } from '@preact/signals-core'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import type { Editor } from '@src/lib/editors/registry/contract'
import type { KclSourceSnapshot } from '@src/lib/kcl/sources'
import type {
  SketchCorrespondenceEndpoint,
  SketchCorrespondenceSnapshot,
} from '@src/lib/kcl/correspondence/sketchContract'
import { createSketchCorrespondenceQuery } from '@src/lib/kcl/sketch/correspondenceQuery'
import type { ReadonlySignal } from '@preact/signals-core'
import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'
import type { EntityStyling } from '@src/lib/scene/entityStyling'
import type { EntityStyleHandle } from '@src/lib/scene/entityStyling'
import fsZds from '@src/lib/fs-zds'

/** A native session publishes paired source/graph snapshots after rendering, including provisional previews. Exact source matching gates linked views. */
export function createSketchCorrespondence({
  editor,
  src,
  sketchId,
  surface,
  sources,
  isCurrent,
}: {
  editor: Pick<Editor, 'contents'>
  src: string
  sketchId: number
  surface: {
    selected: ReadonlySignal<readonly SketchSolveSelectionId[]>
    entityStyling: EntityStyling<number>
  }
  sources: KclSourceSnapshot | undefined
  isCurrent: () => boolean
}) {
  const rendered = signal<SketchCorrespondenceSnapshot | undefined>(undefined)
  const snapshot = computed(() => {
    const current = rendered.value
    return isCurrent() && editor.contents.value === current?.output.contents
      ? current
      : undefined
  })
  const groups = new Map<symbol, EntityStyleHandle<number>>()
  let projected: symbol | undefined
  const clear = () => {
    for (const group of groups.values()) group.dispose()
    groups.clear()
  }
  const endpoint: SketchCorrespondenceEndpoint = {
    snapshot,
    selectedSources: (current) => {
      if (!isCurrent() || snapshot.peek() !== current) return []
      const query = createSketchCorrespondenceQuery(
        current.graph.objects,
        current.sketchId
      )
      return surface.selected.value.flatMap((id) =>
        typeof id === 'number' ? query.sourcesFor(id) : []
      )
    },
    targetsForCode: (current, range) =>
      isCurrent() && snapshot.peek() === current
        ? createSketchCorrespondenceQuery(
            current.graph.objects,
            current.sketchId
          ).targetsFor(range)
        : [],
    project: (current, layers) => {
      if (current && snapshot.peek() !== current) return
      if (!current || !isCurrent()) {
        clear()
        projected = undefined
        return
      }
      if (projected !== current.identity) {
        clear()
        projected = current.identity
      }
      const wanted = new Set(layers.map((layer) => layer.sourceViewId))
      for (const [id, group] of groups)
        if (!wanted.has(id)) {
          group.dispose()
          groups.delete(id)
        }
      for (const layer of layers) {
        let group = groups.get(layer.sourceViewId)
        if (!group) {
          const created = surface.entityStyling.createGroup(layer.style)
          if (created instanceof Error) continue
          group = created
          groups.set(layer.sourceViewId, group)
        }
        group.set(layer.ids)
      }
    },
  }
  return {
    endpoint,
    rendered: (delta: SceneGraphDelta, contents: string | undefined) => {
      clear()
      projected = undefined
      if (contents === undefined) {
        rendered.value = undefined
        return
      }
      const files = new Map(sources?.files)
      files.set(
        fsZds.join(src || 'main.kcl'),
        new TextEncoder().encode(contents)
      )
      rendered.value = {
        identity: Symbol('native sketch revision'),
        sketchId,
        graph: delta.new_graph,
        output: { src, contents },
        sources: { src: src || 'main.kcl', files },
        filenames: delta.exec_outcome.filenames,
      }
    },
    dispose: () => {
      clear()
      rendered.value = undefined
    },
  }
}
