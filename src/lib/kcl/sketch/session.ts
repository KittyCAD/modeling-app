import type { SelectionSource } from '@src/lib/kcl/selection'
import { createMoveToolInteraction } from '@src/machines/sketchSolve/tools/moveTool/moveTool'
import type { SourceDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  sketchIntent,
  selectedSketchTarget,
} from '@src/lib/kcl/sketch/selection'
import {
  computed,
  effect,
  signal,
  type ReadonlySignal,
} from '@preact/signals-core'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { ModelingInteractionSession } from '@src/lib/kcl/interactions'
import { captureModel } from '@src/lib/kcl/modelingTarget'
import type { SketchRuntime } from '@src/lib/kcl/sketchRuntime'
import { createSketchSurface } from '@src/lib/kcl/sketch/surface'
import { resolveSketchTarget } from '@src/lib/kcl/sketch/target'
import type {
  SketchTool,
  SketchToolDefinition,
} from '@src/lib/kcl/sketch/contract'
import type {
  SceneSelection,
  DialogPickingSession,
} from '@src/lib/scene/selection'
import { documentChanges } from '@src/lib/editors/changes'
import { enterSketchModeAndSyncCamera } from '@src/clientSideScene/CameraControls'
import { isolateHistory } from '@codemirror/commands'
import { Transaction } from '@codemirror/state'
import { isErr, reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'

/** One view borrows native sketch editing and Three.js input until exit, cancellation, or an external edit. */
export async function createSketchSession(
  context: ModelingViewContext,
  signal_: AbortSignal,
  tools: ReadonlySignal<readonly SketchToolDefinition[]>
): Promise<ModelingInteractionSession | Error> {
  const captured = captureModel(context)
  if (isErr(captured)) return captured
  const { scene } = captured
  const phase = signal<'picking' | 'entering' | 'editing' | 'closing'>(
    'picking'
  )
  const error = signal<Error | undefined>(undefined)
  const values = signal<readonly SceneSelection[]>([])
  const equipped = signal<string | undefined>(undefined)
  const defaultPlanes = signal({
    xy: true,
    xz: true,
    yz: true,
  })
  const selectionSource = signal<SelectionSource | undefined>(undefined)
  const selectionSessionId = Symbol('sketch selection')
  let runtime: SketchRuntime | undefined
  let surface: ReturnType<typeof createSketchSurface> | undefined
  let move: ReturnType<typeof createMoveToolInteraction> | undefined
  let circle: SketchTool | undefined
  let picking: DialogPickingSession | undefined
  let cameraEntered = false
  let sketchId: number | undefined
  let latest: SceneGraphDelta | undefined
  let expected = context.executor.editor.state.doc
  let closed = false
  let entering = Promise.resolve()
  let closing: Promise<void> | undefined
  const infra = scene.sceneInfra
  const originalRotate = infra.camControls.enableRotate
  const originalSync = infra.camControls.syncDirection
  const current = () =>
    !closed &&
    !signal_.aborted &&
    !context.executor.editor.signal.aborted &&
    !context.executor.editor.readOnly.peek() &&
    context.session.resource.peek() === scene &&
    context.executor.editor.state.doc === expected
  const publish = (text: string, delta: SceneGraphDelta) => {
    // A commit already in flight may settle during exit; publish only while its source and view still belong to this session.
    if (
      context.executor.editor.signal.aborted ||
      context.executor.editor.readOnly.peek() ||
      context.session.resource.peek() !== scene ||
      context.executor.editor.state.doc !== expected
    )
      return
    runtime?.accept(text, delta)
    const changes = documentChanges(context.executor.editor.state.doc, text)
    context.executor.editor.dispatch({
      changes,
      annotations: [
        isolateHistory.of('full'),
        Transaction.userEvent.of('input.sketch'),
      ],
    })
    expected = context.executor.editor.state.doc
  }
  const render = (
    delta: SceneGraphDelta,
    draft?: { segmentIds: number[]; constraintIds: number[] }
  ) => {
    latest = delta
    surface?.render(delta, draft)
  }
  const deactivateMove = () => {
    const active = move
    move = undefined
    return active?.dispose()
  }
  const activateMove = () => {
    if (!current() || !runtime || !surface || sketchId === undefined || !latest)
      return
    const active = runtime,
      visuals = surface
    let outcome: {
      sourceDelta: SourceDelta
      sceneGraphDelta: SceneGraphDelta
    } = {
      sourceDelta: { text: context.executor.editor.contents.peek() },
      sceneGraphDelta: latest,
    }
    move = createMoveToolInteraction({
      sceneInfra: infra,
      sketchId,
      getState: () => visuals.getState(outcome),
      getCheckpointId: () => active.checkpoint.peek(),
      getLengthUnit: () =>
        scene.runtime.fileSettings.peek().defaultLengthUnit ??
        scene.preferences.defaultUnit.peek(),
      getSettings: active.mutations.getSettings,
      getModelingSettings: () => context.settings.current.peek().modeling,
      mutations: active.move,
      isCurrent: current,
      selection: visuals.selection,
      hover: visuals.updateHover,
      outcome: (result) => {
        outcome = {
          sourceDelta: result.sourceDelta,
          sceneGraphDelta: result.sceneGraphDelta,
        }
        if (result.commit !== false) {
          publish(result.sourceDelta.text, result.sceneGraphDelta)
          error.value = undefined
        }
        if (current()) render(result.sceneGraphDelta)
      },
      onError: (cause) => {
        error.value = isErr(cause)
          ? cause
          : new Error('Unable to move sketch geometry', { cause })
      },
    })
  }
  let equipRevision = 0
  const equip = async (id: string) => {
    const ticket = ++equipRevision
    await deactivateMove()
    await circle?.dispose()
    if (ticket !== equipRevision) return
    circle = undefined
    equipped.value = undefined
    if (!current() || !runtime || !surface || sketchId === undefined || !latest)
      return
    const active = runtime
    const definition = tools.peek().find((tool) => tool.id === id)
    if (!definition) return
    const created = await definition.create({
      infra,
      hover: surface.hover,
      settings: context.settings,
      runtime: active,
      sketchId,
      lengthUnit:
        scene.runtime.fileSettings.peek().defaultLengthUnit ??
        scene.preferences.defaultUnit.peek(),
      getDelta: () => latest!,
      render,
      accept: (result) =>
        publish(result.kclSource.text, result.sceneGraphDelta),
      isCurrent: current,
      onError: (cause) => {
        error.value = cause
      },
    })
    if (!current() || ticket !== equipRevision) {
      await created.dispose()
      return
    }
    circle = created
    equipped.value = id
  }
  const planes = async (show: boolean) => {
    defaultPlanes.value = { xy: show, xz: show, yz: show }
    for (const id of [
      captured.execState.defaultPlanes?.xy,
      captured.execState.defaultPlanes?.xz,
      captured.execState.defaultPlanes?.yz,
    ])
      if (id)
        await scene.commands.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'object_visible', object_id: id, hidden: !show },
        })
  }
  const dispose = () => {
    if (closing) return closing
    closed = true
    equipRevision++
    phase.value = 'closing'
    stopSource()
    stopReadOnly()
    signal_.removeEventListener('abort', abort)
    picking?.activate(null)
    closing = (async () => {
      await entering
      await circle?.dispose()
      await deactivateMove()
      selectionSource.value = undefined
      surface?.dispose()
      try {
        await runtime?.close(sketchId)
      } finally {
        picking?.close()
        await planes(false)
        infra.camControls.enableRotate = originalRotate
        if (cameraEntered) {
          await infra.camControls.snapToPerspectiveBeforeHandingBackControlToEngine()
          // The sketch camera changes projection independently of preferences.
          // Restore the configured projection when returning control to modeling.
          await infra.camControls.setCameraProjection(
            scene.preferences.camera.peek().cameraProjection
          )
        }
        infra.camControls.syncDirection = originalSync
      }
    })()
    return closing
  }
  const exit = () => context.interactions.close()
  const abort = () => {
    void dispose().catch(reportRejection)
  }
  const stopSource = context.executor.editor.subscribe((transaction) => {
    if (transaction.docChanged && transaction.startState.doc !== expected)
      return
    // Own publication updates expected synchronously after dispatch; external changes close on the next microtask.
    queueMicrotask(() => {
      if (!closed && context.executor.editor.state.doc !== expected)
        void exit().catch(reportRejection)
    })
  })
  const stopReadOnly = effect(() => {
    if (context.executor.editor.readOnly.value)
      queueMicrotask(() => {
        if (!closed) void exit().catch(reportRejection)
      })
  })
  signal_.addEventListener('abort', abort, { once: true })
  const enter = (selection: SceneSelection) => {
    if (phase.peek() !== 'picking' || !current()) return
    phase.value = 'entering'
    error.value = undefined
    entering = (async () => {
      const target = await resolveSketchTarget(
        captured,
        selection.reference,
        sketchIntent(selection.reference) ?? 'new'
      )
      if (isErr(target)) return Promise.reject(target)
      if (!current() || !captured.isCurrent()) return
      await planes(false)
      picking?.activate(null)
      runtime = await scene.runtime.openSketch(async () => {
        context.interactions.error.value = new Error(
          'Source or execution settings changed. Sketch editing ended.'
        )
        await exit()
      })
      if (!current()) return
      const objects = await runtime.synchronize(captured.ast)
      if (!current()) return
      if (target.existing !== undefined) {
        sketchId = target.existing
        const result = await runtime.edit(sketchId)
        latest = result.sceneGraphDelta
      } else if (target.create) {
        const args = target.create(objects)
        if (isErr(args)) return Promise.reject(args)
        const result = await runtime.create(args)
        sketchId = result.sketchId
        latest = result.sceneGraphDelta
        publish(result.sourceDelta.text, result.sceneGraphDelta)
      }
      if (!current() || sketchId === undefined || !latest) return
      surface = createSketchSurface(
        infra,
        context.settings,
        target.plane,
        sketchId
      )
      const ownedSurface = surface
      const ownedSketchId = sketchId
      selectionSource.value = {
        items: computed(() =>
          ownedSurface.selected.value.map((id) => ({
            kind: 'sketch' as const,
            sessionId: selectionSessionId,
            sketchId: ownedSketchId,
            id,
          }))
        ),
        canClear: computed(
          () =>
            !closed &&
            phase.value === 'editing' &&
            !!ownedSurface.selected.value.length
        ),
        clear: () => {
          if (!closed && phase.peek() === 'editing')
            ownedSurface.select([], true)
        },
      }

      cameraEntered = true
      await enterSketchModeAndSyncCamera(
        scene.commands,
        target.plane.entityId,
        infra.camControls,
        selection.reference.type === 'face'
      )
      if (!current()) return
      if (scene.presentation === 'local')
        await infra.camControls.transitionToSketch(surface.group, signal_)
      infra.camControls.syncDirection = 'clientToEngine'
      render(latest)
      activateMove()
      phase.value = 'editing'
    })().catch(async (cause) => {
      error.value = isErr(cause)
        ? cause
        : new Error('Unable to enter sketch', { cause })
      selectionSource.value = undefined
      surface?.dispose()
      surface = undefined
      if (cameraEntered) {
        await infra.camControls.disableSketchMode()
        cameraEntered = false
        infra.camControls.syncDirection = originalSync
        infra.camControls.enableRotate = originalRotate
      }
      if (runtime) {
        await runtime.close(sketchId)
        runtime = undefined
        sketchId = undefined
      }
      if (!closed) {
        phase.value = 'picking'
        picking?.bindCurrentModel()
        picking?.activate('sketch.target')
        await planes(true)
      }
    })
  }
  const started = scene.selection.beginPicking({
    arguments: [
      {
        id: 'sketch.target',
        filter: ['object', 'face', 'region', 'solid2d', 'segment'],
        multiple: false,
        value: values,
        accepts: (reference) => sketchIntent(reference) !== undefined,
        setValue: (next) => {
          values.value = next
          if (next[0]) enter(next[0])
        },
      },
    ],
  })
  if (isErr(started)) {
    stopSource()
    stopReadOnly()
    signal_.removeEventListener('abort', abort)
    return started
  }
  picking = started
  picking.activate('sketch.target')
  const selected = selectedSketchTarget(scene.selection.selected.peek())
  await planes(!selected)
  if (selected) enter(selected)
  const prompt = computed(() =>
    phase.value === 'picking'
      ? 'Select a plane, planar face, or sketch'
      : phase.value === 'entering'
        ? 'Entering sketch...'
        : phase.value === 'closing'
          ? 'Leaving sketch...'
          : equipped.value
            ? (circle?.prompt.value ?? 'Sketch editing')
            : 'Sketch editing'
  )
  const toolbar = computed(() =>
    phase.value === 'editing'
      ? [
          ...tools.value.map((tool) => ({
            id: tool.id,
            groupId: tool.groupId,
            title: tool.name,
            icon: tool.icon,
            status: 'available' as const,
            description: '',
            links: [],
            isActive: equipped.value === tool.id,
            onClick: () => {
              void equip(tool.id).catch(reportRejection)
            },
          })),
          {
            id: 'sketch.exit',
            groupId: 'kcl.sketch.session',
            title: 'Exit Sketch',
            icon: 'checkmark' as const,
            status: 'available' as const,
            description: '',
            links: [],
            onClick: () => {
              void exit().catch(reportRejection)
            },
          },
        ]
      : [
          {
            id: 'sketch.cancel',
            groupId: 'kcl.sketch.session',
            title: 'Cancel',
            icon: 'close' as const,
            status: 'available' as const,
            description: '',
            links: [],
            onClick: () => {
              void exit().catch(reportRejection)
            },
          },
        ]
  )
  return {
    id: 'kcl.sketch',
    selection: selectionSource,
    toolbar,
    prompt,
    defaultPlanes,
    error,
    escape: async () => {
      if (move?.isDragging()) {
        await deactivateMove()
        activateMove()
        return
      }
      if (circle && (await circle.escape())) {
        return
      } else if (circle) {
        await circle.dispose()
        circle = undefined
        equipped.value = undefined
        if (current()) activateMove()
      } else if (surface?.selected.peek().length) surface.select([])
      else await exit()
    },
    dispose,
  }
}
