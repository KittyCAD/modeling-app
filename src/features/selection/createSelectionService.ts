import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { KclSceneService } from '@src/contracts/kclScene'
import type { ScenePoint } from '@src/contracts/scene'
import type {
  ScenePicker,
  SelectedEntity,
  SelectionMode,
  SelectionService,
} from '@src/contracts/selection'

export interface SelectionServiceDependencies {
  /** Absent until something is rendering. */
  picker: () => ScenePicker | undefined
  /** Absent until KCL has run. Selection still works, just unnamed. */
  scene: () => KclSceneService | undefined
}

/**
 * What is selected, and how a click becomes a selection.
 *
 * Holds entity ids and whatever the artifact graph says about them. It never
 * learns how a pick was made, which is what lets a click in the viewport, a
 * cursor in the editor, and a modelling operation's argument all talk about the
 * same selection.
 *
 * Resolved eagerly rather than lazily: what an entity *is* is read from the graph
 * at the moment it is selected, so a later run that rebuilds the scene cannot
 * silently change the meaning of a selection made against the old one. A stale
 * selection is better than one that quietly means something else.
 */
export function createSelectionService(
  dependencies: SelectionServiceDependencies
): SelectionService {
  const { picker, scene } = dependencies

  const entities = signal<readonly SelectedEntity[]>([])
  const picking = signal(false)

  const describe = (entityId: string): SelectedEntity => {
    const graph = scene()
    return {
      entityId,
      kind: graph?.artifactFor(entityId)?.type ?? null,
      sourceRange: graph?.sourceRangeFor(entityId) ?? null,
    }
  }

  const select = (
    entityIds: readonly string[],
    mode: SelectionMode = 'replace'
  ) => {
    if (mode === 'replace') {
      entities.value = entityIds.map(describe)
      return
    }

    if (mode === 'remove') {
      const dropped = new Set(entityIds)
      entities.value = entities.value.filter(
        (entity) => !dropped.has(entity.entityId)
      )
      return
    }

    const held = new Set(entities.value.map((entity) => entity.entityId))
    entities.value = [
      ...entities.value,
      ...entityIds.filter((id) => !held.has(id)).map(describe),
    ]
  }

  return {
    entities: computed(() => entities.value),
    picking: computed(() => picking.value),
    select,

    async selectAt(at: ScenePoint, mode: SelectionMode = 'replace') {
      const available = picker()
      if (!available?.ready.peek()) return

      picking.value = true
      try {
        const entityId = await available.pick(at)

        /*
         * A click on empty space clears, and only when it was a plain click.
         *
         * Shift-clicking the background while building up a selection is a miss,
         * not an instruction to start again — losing a five-part selection to a
         * slightly wide click is the kind of thing people stop trusting.
         */
        if (entityId === null) {
          if (mode === 'replace') entities.value = []
          return
        }

        select([entityId], mode)
      } catch (error) {
        // A pick that failed is not a selection change. The engine may have gone
        // away mid-click, which the connection already reports.
        console.warn('selection: could not ask what was clicked', error)
      } finally {
        picking.value = false
      }
    },

    clear() {
      entities.value = []
    },
  }
}
