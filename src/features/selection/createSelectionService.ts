import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { KclSceneService } from '@src/contracts/kclScene'
import type { ScenePoint } from '@src/contracts/scene'
import type {
  PickedRegion,
  ScenePicker,
  SelectedEntity,
  SelectionMode,
  SelectionService,
} from '@src/contracts/selection'
import { faceReference, sweptPathFor } from '@src/lib/kcl/faceReferences'

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

  const describe = (
    entityId: string,
    region: PickedRegion | null = null,
    originCurve: string | null = null
  ): SelectedEntity => {
    const graph = scene()
    return {
      entityId,
      kind: graph?.artifactFor(entityId)?.type ?? null,
      sourceRange: graph?.sourceRangeFor(entityId) ?? null,
      region,
      originCurve,
    }
  }

  /**
   * Ask the engine which curve made a face, when the file cannot say.
   *
   * Only for a face whose reference cannot be derived — which today means a wall
   * of a swept region, where every segment of the region carries the range of the
   * `region(…)` call and none of them is a line anybody could name. The engine
   * may know an origin the graph flattened; usually it does not, because the
   * graph was built from this very answer.
   *
   * Asked at selection time, alongside the region question and for the same
   * reason: the click is where the engine is available, and turning a selection
   * into KCL afterwards has to be able to happen without waiting.
   */
  const originCurveFor = async (
    entityId: string,
    picker: ScenePicker
  ): Promise<string | null> => {
    const graph = scene()
    const executed = graph?.program.value
    if (!graph || !executed) return null

    const context = {
      artifacts: graph.artifacts.value,
      program: executed.ast,
      source: executed.source,
    }

    // A face the file can already name needs nothing from the engine.
    if (faceReference(entityId, context)?.kind !== 'unavailable') return null

    const path = sweptPathFor(entityId, context)
    if (!path) return null

    const faces = await picker.sweptFaces(path)
    const curve = faces.find((face) => face.face === entityId)?.curve ?? null

    /*
     * Worth reporting when it differs. kcl-lib sets a wall's segment to this
     * curve, so the two agreeing is the expected case and tells us the engine has
     * nothing more to offer; the two differing is the case this call exists for,
     * and it should be visible when it happens.
     */
    const held = graph.artifactFor(entityId)
    const known = held?.type === 'wall' ? held.segId : null
    if (curve && curve !== known) {
      console.info(
        `selection: engine names a different curve for face ${entityId}`,
        { graph: known, engine: curve }
      )
    }

    return curve && curve !== known ? curve : null
  }

  const select = (
    entityIds: readonly string[],
    mode: SelectionMode = 'replace'
  ) => {
    if (mode === 'replace') {
      entities.value = entityIds.map((id) => describe(id))
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
      ...entityIds.filter((id) => !held.has(id)).map((id) => describe(id)),
    ]
  }

  return {
    entities: computed(() => entities.value),
    picking: computed(() => picking.value),
    select,

    async selectAt(at: ScenePoint, mode: SelectionMode = 'replace') {
      const available = picker()
      if (!available?.ready.peek()) return null

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
          return null
        }

        /*
         * An entity the graph cannot name might be a region.
         *
         * A region is the V2 way to name an area to extrude and it has no
         * artifact, because it does not exist until it is written into the file.
         * So the absence of an artifact is the signal to ask the engine how the
         * area *would* be written — and asking only then means a click on a face
         * the graph already knows does not pay for a question with a known
         * answer.
         */
        const known = scene()?.artifactFor(entityId)
        const region = known
          ? null
          : await available.describeRegion(entityId).catch(() => null)

        /*
         * A face the file cannot name is the one case worth a second question.
         * Failure is an answer here too: an engine that will not say leaves the
         * selection exactly as it would have been.
         */
        const originCurve = known
          ? await originCurveFor(entityId, available).catch(() => null)
          : null

        if (mode === 'remove') {
          entities.value = entities.value.filter(
            (candidate) => candidate.entityId !== entityId
          )
          return entityId
        }

        const entity = describe(entityId, region, originCurve)

        if (mode === 'add') {
          const held = entities.value.some(
            (candidate) => candidate.entityId === entityId
          )
          if (!held) entities.value = [...entities.value, entity]
          return entityId
        }

        entities.value = [entity]
        return entityId
      } catch (error) {
        // A pick that failed is not a selection change. The engine may have gone
        // away mid-click, which the connection already reports.
        console.warn('selection: could not ask what was clicked', error)
        return null
      } finally {
        picking.value = false
      }
    },

    clear() {
      entities.value = []
    },
  }
}
