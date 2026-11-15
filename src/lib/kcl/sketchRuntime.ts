import { signal } from '@preact/signals-core'
import type { MoveToolMutations } from '@src/machines/sketchSolve/tools/moveTool/host'
import type {
  ApiObject,
  SceneGraphDelta,
  SketchCtor,
  SketchMutationOutcome,
  EditSketchOutcome,
  NewSketchOutcome,
  RestoreSketchCheckpointOutcome,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { errFromErrWithOutputs } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CircleRuntime } from '@src/machines/sketchSolve/tools/circleOperations'

/** Serialized native sketch operations; source publication remains the editor session's responsibility. */
export function createSketchRuntime(
  native: InstanceType<ModuleType['Context']>,
  run: <T>(work: () => Promise<T>) => Promise<T>,
  getSettings: CircleRuntime['getSettings'],
  acknowledge: (text: string, delta: SceneGraphDelta) => void,
  released: (sketchId?: number) => void | Promise<void>,
  initialSource = ''
) {
  let closed = false
  let source = initialSource
  const sources = new WeakMap<SceneGraphDelta['new_graph'], string>()
  const observe = (delta: SceneGraphDelta, text = source) => {
    source = text
    sources.set(delta.new_graph, text)
  }
  const checkpoint = signal<number | null>(null)
  const call = <T>(work: () => Promise<T>) =>
    run(() =>
      closed ? Promise.reject(new Error('Sketch session closed')) : work()
    )
  const mutation = async (work: () => Promise<SketchMutationOutcome>) => {
    const result = await call(work)
    observe(result.sceneGraphDelta, result.sourceDelta.text)
    if (result.checkpointId != null)
      checkpoint.value = Number(result.checkpointId)
    return {
      kclSource: result.sourceDelta,
      sceneGraphDelta: result.sceneGraphDelta,
      checkpointId:
        result.checkpointId == null ? null : Number(result.checkpointId),
    }
  }
  const settings = () => JSON.stringify(getSettings())
  const circle: CircleRuntime = {
    getSettings,
    prepareForSketchInsertion: async () => {},
    addSegment: (version, sketch, segment, label, config, checkpoint = false) =>
      mutation(() =>
        native.add_segment(
          JSON.stringify(version),
          JSON.stringify(sketch),
          JSON.stringify(segment),
          label,
          JSON.stringify(config),
          checkpoint
        )
      ),
    editSegments: (
      version,
      sketch,
      segments,
      config,
      checkpoint = false,
      anchors,
      commit = true,
      drag = [],
      labels = []
    ) =>
      mutation(() =>
        native.edit_segments(
          JSON.stringify(version),
          JSON.stringify(sketch),
          JSON.stringify(segments),
          JSON.stringify(config),
          checkpoint,
          JSON.stringify(anchors ?? null),
          JSON.stringify(drag),
          commit,
          JSON.stringify(labels)
        )
      ),
    addConstraint: (version, sketch, constraint, config, checkpoint = false) =>
      mutation(() =>
        native.add_constraint(
          JSON.stringify(version),
          JSON.stringify(sketch),
          JSON.stringify(constraint),
          JSON.stringify(config),
          checkpoint
        )
      ),
  }
  const move: MoveToolMutations = {
    editSegments: circle.editSegments,
    addConstraint: circle.addConstraint,
    editDistanceConstraintLabelPosition: (
      version,
      sketch,
      id,
      position,
      config,
      createCheckpoint = false,
      anchors = [],
      commit = true
    ) =>
      mutation(() =>
        native.edit_distance_constraint_label_position(
          JSON.stringify(version),
          JSON.stringify(sketch),
          JSON.stringify(id),
          JSON.stringify(position),
          JSON.stringify(config),
          createCheckpoint,
          JSON.stringify(anchors),
          commit
        )
      ),
    deleteObjects: (
      version,
      sketch,
      constraints,
      segments,
      config,
      createCheckpoint = false
    ) =>
      mutation(() =>
        native.delete_objects(
          JSON.stringify(version),
          JSON.stringify(sketch),
          JSON.stringify(constraints),
          JSON.stringify(segments),
          JSON.stringify(config),
          createCheckpoint
        )
      ),
    restoreSketchCheckpoint: (id) =>
      call(async () => {
        const restored: RestoreSketchCheckpointOutcome =
          await native.restore_sketch_checkpoint(JSON.stringify(id))
        checkpoint.value = id
        observe(restored.sceneGraphDelta, restored.sourceDelta.text)
        return {
          kclSource: restored.sourceDelta,
          sceneGraphDelta: restored.sceneGraphDelta,
        }
      }),
    sketchExecuteMock: (version, sketch) =>
      mutation(() =>
        native.sketch_execute_mock(
          JSON.stringify(version),
          JSON.stringify(sketch),
          settings()
        )
      ),
  }
  return {
    sourceFor: (delta: SceneGraphDelta) =>
      closed ? undefined : sources.get(delta.new_graph),
    mutations: circle,
    move,
    checkpoint,
    synchronize: (ast: unknown) =>
      call(async (): Promise<ApiObject[]> => {
        await native.clear_sketch_checkpoints()
        checkpoint.value = null
        const result = await native.hack_set_program(
          JSON.stringify(ast),
          settings()
        )
        if (result.type !== 'Success')
          return Promise.reject(errFromErrWithOutputs(result.error))
        return result.sceneGraph.objects
      }),
    create: (args: SketchCtor) =>
      call(async (): Promise<NewSketchOutcome> => {
        const result: NewSketchOutcome = await native.new_sketch(
          '0',
          '0',
          '0',
          JSON.stringify(args),
          settings()
        )
        observe(result.sceneGraphDelta, result.sourceDelta.text)
        checkpoint.value =
          result.checkpointId == null ? null : Number(result.checkpointId)
        return result
      }),
    edit: (id: number) =>
      call(async (): Promise<EditSketchOutcome> => {
        const result: EditSketchOutcome = await native.edit_sketch(
          '0',
          '0',
          '0',
          JSON.stringify(id),
          settings()
        )
        observe(result.sceneGraphDelta)
        checkpoint.value =
          result.checkpointId == null ? null : Number(result.checkpointId)
        return result
      }),
    remove: (id: number, segments: number[], constraints: number[]) =>
      mutation(() =>
        native.delete_objects(
          '0',
          JSON.stringify(id),
          JSON.stringify(constraints),
          JSON.stringify(segments),
          settings(),
          false
        )
      ),
    accept: (text: string, delta: SceneGraphDelta) => {
      observe(delta, text)
      acknowledge(text, delta)
    },
    close: async (id?: number) => {
      if (closed) return
      closed = true
      try {
        if (id !== undefined)
          await run(async () =>
            native.exit_sketch('0', JSON.stringify(id), settings())
          )
      } finally {
        await released(id)
      }
    },
  }
}
export type SketchRuntime = ReturnType<typeof createSketchRuntime>
