import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { toast } from 'react-hot-toast'
import { type InstanceProps, create } from 'react-modal-promise'

import { ActionButton } from '@src/components/ActionButton'
import { CreateNewVariable } from '@src/components/AvailableVarsHelpers'
import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'

type ModalResolve = { variableName: string }
type ModalReject = boolean
type SetVarNameModalProps = InstanceProps<ModalResolve, ModalReject> & {
  valueName: string
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
}: SetVarNameModalProps) => {
  const { isNewVariableNameUnique, newVariableName, setNewVariableName } =
    useCalculateKclExpression({ value: '', initialVariableName: valueName })

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="fixed inset-0 z-40 overflow-y-auto p-4 pt-[25vh]"
        onClose={onReject}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0 translate-y-4"
          enterTo="opacity-100 translate-y-0"
          leave="ease-in duration-75"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Dialog.Overlay className="fixed inset-0 bg-chalkboard-10/70 dark:bg-chalkboard-110/50" />
        </Transition.Child>

        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <Dialog.Panel className="rounded relative mx-auto px-4 py-8 bg-chalkboard-10 dark:bg-chalkboard-100 border dark:border-chalkboard-70 max-w-xl w-full shadow-lg">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                onResolve({
                  variableName: newVariableName,
                })
                toast.success(`Added variable ${newVariableName}`)
              }}
            >
              <CreateNewVariable
                setNewVariableName={setNewVariableName}
                newVariableName={newVariableName}
                isNewVariableNameUnique={isNewVariableNameUnique}
                shouldCreateVariable={true}
                showCheckbox={false}
              />
              <div className="mt-8 flex justify-between">
                <ActionButton Element="button" onClick={() => onReject(false)}>
                  Cancel
                </ActionButton>
                <ActionButton
                  Element="button"
                  type="submit"
                  disabled={!isNewVariableNameUnique}
                  iconStart={{ icon: 'plus' }}
                >
                  Add variable
                </ActionButton>
              </div>
            </form>
          </Dialog.Panel>
        </Transition.Child>
      </Dialog>
    </Transition>
  )
}
