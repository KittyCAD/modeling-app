import type { EntityReference } from '@kittycad/lib'
import {
  computed,
  effect,
  signal,
  type ReadonlySignal,
} from '@preact/signals-core'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'
import type { KclManager } from '@src/lang/KclManager'
import type {
  modelingMachine,
  ModelingMachineEvent,
} from '@src/machines/modelingMachine'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import type { commandBarMachine } from '@src/machines/commandBarMachine'
import type { MachineSceneResource } from '@src/lib/kcl/scene/open'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { PickingArgument } from '@src/lib/kcl/scene/selection'
import type {
  SelectionSource,
  ActiveSelectionItem,
} from '@src/lib/kcl/selection'
import {
  isEngineRegionSelection,
  isDefaultPlaneSelection,
  isEnginePrimitiveSelection,
} from '@src/lib/selections'
import { isModelingDialogCommand } from '@src/lib/commandUtils'
import { attachSceneKeyboardFocus } from '@src/lib/kcl/scene/selectionAdapter'
import { sendQueryEntityTypeWithPointFromSceneClick } from '@src/lib/kcl/scene/picking'
import { reportRejection } from '@src/lib/trap'

/** Hand input to one machine while exposing selection through the existing mode-independent facade. Dialogs borrow picking without changing ordinary machine selection. */
export function bindMachinePicking({
  scene,
  model,
  actor,
  state,
  child,
  commandState,
  readOnly,
  wasm,
  isClosed,
}: {
  scene: MachineSceneResource
  model: KclManager
  actor: ActorRefFrom<typeof modelingMachine>
  state: ReadonlySignal<SnapshotFrom<typeof modelingMachine>>
  child: ReadonlySignal<SnapshotFrom<typeof sketchSolveMachine> | undefined>
  commandState: ReadonlySignal<SnapshotFrom<typeof commandBarMachine>>
  readOnly: ReadonlySignal<boolean>
  wasm: ModuleType
  isClosed: () => boolean
}) {
  const argument = signal<PickingArgument | undefined>(undefined)
  const clear = () => {
    if (!isClosed())
      actor.send({
        type: 'Set selection',
        data: {
          selectionType: 'completeSelection',
          selection: { graphSelections: [], otherSelections: [] },
        },
      })
  }
  const picking = scene.machineInput.handoffPicking({
    enabled: computed(
      () => !state.value.matches('sketchSolveMode') && !readOnly.value
    ),
    argument,
    dialogOpen: computed(() => {
      const command = commandState.value.context.selectedCommand
      return (
        !commandState.value.matches('Closed') &&
        !!command &&
        command.machineActor === actor &&
        isModelingDialogCommand(command)
      )
    }),
    clear,
    restore: () => {
      if (!isClosed())
        model.setSelectionFilter(
          [...model.selectionFilter.peek()],
          wasm,
          actor.getSnapshot().context.selectionRanges
        )
    },
    setFilter: (filter) => {
      if (isClosed()) return new Error('The picking owner closed.')
      model.setSelectionFilter([...filter], wasm)
      return undefined
    },
  })
  const stopFocus = attachSceneKeyboardFocus(
    scene.sceneInfra.renderer.domElement
  )
  const send = (event: ModelingMachineEvent) => {
    if (isClosed()) return
    if (
      scene.selection.internalPicking.peek() &&
      [
        'Set selection',
        'Enter sketch',
        'Edit sketch solve',
        'Select sketch solve plane',
      ].includes(event.type)
    )
      return
    actor.send(event)
  }
  scene.sceneInfra.setSend(send)
  scene.machineInput.manager.modelingSend = send
  const stopSelection = effect(() => {
    const snapshot = state.value
    const filter = model.selectionFilter.value
    void scene.selection.model.value
    picking.observe(
      [
        ...snapshot.context.selectionRanges.graphSelections.flatMap((item) =>
          item.entityRef ? [item.entityRef] : []
        ),
        ...snapshot.context.selectionRanges.otherSelections.flatMap<EntityReference>(
          (item) =>
            isEngineRegionSelection(item)
              ? [{ type: 'region', region_id: item.id }]
              : isDefaultPlaneSelection(item)
                ? [{ type: 'plane', plane_id: item.id }]
                : []
        ),
      ],
      filter
    )
  })
  const click = (event: PointerEvent) => {
    if (
      isClosed() ||
      event.button !== 0 ||
      event.defaultPrevented ||
      scene.sceneInfra.camControls.wasDragging ||
      readOnly.peek()
    )
      return
    if (scene.selection.internalPicking.peek()) {
      scene.selection.pick(event, event.shiftKey).catch(reportRejection)
      return
    }
    const current = actor.getSnapshot()
    if (current.matches('Sketch') || current.matches('sketchSolveMode')) return
    void sendQueryEntityTypeWithPointFromSceneClick(
      event,
      scene.sceneInfra.renderer.domElement,
      scene.machineInput.manager
    ).catch(reportRejection)
  }
  const sessionId = Symbol('machine sketch')
  const sketch: SelectionSource = {
    items: computed(() =>
      (child.value?.context.selectedIds ?? []).map((id) => ({
        kind: 'sketch' as const,
        sessionId,
        sketchId: child.value!.context.sketchId,
        id,
      }))
    ),
    canClear: computed(() => !!child.value?.context.selectedIds.length),
    clear: () => {
      if (!isClosed())
        actor.getSnapshot().children.sketchSolveMachine?.send({
          type: 'update selected ids',
          data: { selectedIds: [], replaceExistingSelection: true },
        })
    },
  }
  const selection: SelectionSource = {
    items: computed<readonly ActiveSelectionItem[]>(() => {
      if (state.value.matches('sketchSolveMode')) return sketch.items.value
      const model = scene.selection.model.value
      const references: ActiveSelectionItem[] =
        scene.selection.displayed.value.map((value) => ({
          kind: 'model',
          value,
        }))
      if (!model || scene.selection.internalPicking.value) return references
      // Preserve native primitive identity instead of inventing an incomplete semantic edge/vertex reference.
      return [
        ...references,
        ...state.value.context.selectionRanges.otherSelections
          .filter(isEnginePrimitiveSelection)
          .map((selection) => ({
            kind: 'engine-primitive' as const,
            model,
            selection,
          })),
      ]
    }),
    canClear: computed(() =>
      state.value.matches('sketchSolveMode')
        ? sketch.canClear.value
        : !!(
            state.value.context.selectionRanges.graphSelections.length ||
            state.value.context.selectionRanges.otherSelections.length
          )
    ),
    clear: () => {
      if (actor.getSnapshot().matches('sketchSolveMode')) sketch.clear()
      else clear()
    },
  }
  return {
    argument,
    sketch,
    selection,
    attach: () =>
      scene.sceneInfra.renderer.domElement.addEventListener('pointerup', click),
    stopInput: () => {
      stopSelection()
      stopFocus()
      if (scene.sceneInfra.modelingSend === send)
        scene.sceneInfra.setSend(() => {})
      if (scene.machineInput.manager.modelingSend === send)
        scene.machineInput.manager.modelingSend = () => {}
      scene.sceneInfra.renderer.domElement.removeEventListener(
        'pointerup',
        click
      )
    },
    release: picking.release,
  }
}
