import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useState } from 'react'
import { useCalc, CreateNewVariable } from './AvailableVarsHelpers'

export const SetVarNameModal = ({
  isOpen,
  onResolve,
  onReject,
  valueName,
}: {
  isOpen: boolean
  onResolve: (a: { variableName?: string }) => void
  onReject: (a: any) => void
  value: number
  valueName: string
}) => {
  const { isNewVariableNameUnique, newVariableName, setNewVariableName } =
    useCalc({ value: '', initialVariableName: valueName })

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={onReject}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <Dialog.Title
                  as="h3"
                  className="text-lg font-medium leading-6 text-gray-900 capitalize"
                >
                  Set {valueName}
                </Dialog.Title>

                <CreateNewVariable
                  setNewVariableName={setNewVariableName}
                  newVariableName={newVariableName}
                  isNewVariableNameUnique={isNewVariableNameUnique}
                  shouldCreateVariable={true}
                  setShouldCreateVariable={() => {}}
                />
                <div className="mt-4">
                  <button
                    type="button"
                    disabled={!isNewVariableNameUnique}
                    className={`inline-flex justify-center rounded-md border border-transparent bg-blue-100 px-4 py-2 text-sm font-medium text-blue-900 hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                      !isNewVariableNameUnique
                        ? 'opacity-50 cursor-not-allowed'
                        : ''
                    }`}
                    onClick={() =>
                      onResolve({
                        variableName: newVariableName,
                      })
                    }
                  >
                    Add variable
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
