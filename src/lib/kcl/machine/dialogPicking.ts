import { computed } from '@preact/signals-core'
import {
  filterDialogSelection,
  type SelectionArgument,
} from '@src/components/ModelingDialog/arguments'
import { resolveToCodeRef } from '@src/lang/queryAst'
import { engineTopologyFallbackFromReference } from '@src/lib/selections'
import type { MachineModelingOwner } from '@src/lib/kcl/machine/host'
import type { PickingArgument, SceneSelection } from '@src/lib/scene/selection'
import { defaultSelectionFilter } from '@src/lib/selectionFilterUtils'

/** Linked views offer targets through the same argument filter used by the legacy form and machine selection. */
export function machineDialogPicking(
  owner: MachineModelingOwner,
  field: { name: string; arg: SelectionArgument }
): PickingArgument {
  const { name, arg } = field
  const selection = (values: readonly SceneSelection[]) => ({
    graphSelections: values.map(({ reference }) => ({
      entityRef: reference,
      ...resolveToCodeRef({ entityRef: reference }, owner.model.artifactGraph),
      engineTopologyFallback: engineTopologyFallbackFromReference(reference),
    })),
    otherSelections: [],
  })
  return {
    id: name,
    filter: arg.selectionFilter ?? defaultSelectionFilter,
    multiple: arg.multiple,
    value: computed(() => {
      const model = owner.scene.selection.model.value
      return model
        ? owner.state.value.context.selectionRanges.graphSelections.flatMap(
            (item) =>
              item.entityRef ? [{ reference: item.entityRef, model }] : []
          )
        : []
    }),
    accepts: (reference) => {
      const model = owner.scene.selection.model.peek()
      return (
        !!model &&
        !!filterDialogSelection(
          selection([{ model, reference }]),
          arg,
          owner.model.ast,
          owner.model.artifactGraph
        ).graphSelections.length
      )
    },
    setValue: (values) => {
      if (
        values.some(
          (value) => value.model !== owner.scene.selection.model.peek()
        )
      )
        return
      const next = filterDialogSelection(
        selection(arg.multiple ? values : values.slice(0, 1)),
        arg,
        owner.model.ast,
        owner.model.artifactGraph
      )
      owner.actor.send({
        type: 'Set selection',
        data: { selectionType: 'completeSelection', selection: next },
      })
    },
  }
}
