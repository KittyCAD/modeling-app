import { Dialog } from '@headlessui/react'
import { toast } from 'react-hot-toast'
import { type InstanceProps, create } from 'react-modal-promise'

import { ActionButton } from '@src/components/ActionButton'
import { CreateNewVariable } from '@src/components/AvailableVarsHelpers'
import { useSingletons } from '@src/lib/boot'
import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'
import { platform } from '@src/lib/utils'
import type { Selections } from '@src/machines/modelingSharedTypes'

type ModalResolve = { variableName: string }
type ModalReject = boolean
type SetVarNameModalProps = InstanceProps<ModalResolve, ModalReject> & {
  valueName: string
  selectionRanges: Selections
}

export const createSetVarNameModal = create<
  SetVarNameModalProps,
  ModalResolve,
  ModalReject
>

export const SetVarNameModal = ({
  isOpen,
  onResolve,
  onReject,
  valueName,
  selectionRanges,
}: SetVarNameModalProps) => {
  const { kclManager } = useSingletons()
  const { isNewVariableNameUnique, newVariableName, setNewVariableName } =
    useCalculateKclExpression({
      value: '',
      initialVariableName: valueName,
      selectionRanges,
      rustContext: kclManager.rustContext,
      code: kclManager.codeSignal.value,
      ast: kclManager.astSignal.value,
      variables: kclManager.variablesSignal.value,
    })
  const cancelButton = (
    <ActionButton
      key="cancel"
      Element="button"
      type="button"
      onClick={() => onReject(false)}
    >
      Cancel
    </ActionButton>
  )
  const confirmButton = (
    <ActionButton
      key="confirm"
      Element="button"
      type="submit"
      disabled={!isNewVariableNameUnique}
      iconStart={{ icon: 'plus' }}
    >
      Add variable
    </ActionButton>
  )
  const orderedButtons =
    platform() === 'windows'
      ? [confirmButton, cancelButton]
      : [cancelButton, confirmButton]

  return (
    <Dialog
      open={isOpen}
      as="div"
      className="fixed inset-0 z-40 overflow-y-auto p-4 pt-[25vh]"
      onClose={onReject}
    >
      <Dialog.Overlay className="fixed inset-0 bg-chalkboard-10/70 dark:bg-chalkboard-110/50" />
      <Dialog.Panel className="rounded relative mx-auto px-4 py-8 bg-chalkboard-10 dark:bg-chalkboard-100 border dark:border-chalkboard-70 max-w-xl w-full shadow-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onResolve({
              variableName: newVariableName,
            })
            toast.success(`Added variable ${newVariableName}.`)
          }}
        >
          <CreateNewVariable
            setNewVariableName={setNewVariableName}
            newVariableName={newVariableName}
            isNewVariableNameUnique={isNewVariableNameUnique}
            shouldCreateVariable={true}
            showCheckbox={false}
          />
          <div className="mt-8 flex justify-end gap-2">{orderedButtons}</div>
        </form>
      </Dialog.Panel>
    </Dialog>
  )
}
