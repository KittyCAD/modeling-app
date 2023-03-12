import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useState } from 'react'
import { Value } from '../lang/abstractSyntaxTree'
import {
  AvailableVars,
  addToInputHelper,
  useCalc,
  CalcResult,
  CreateNewVariable,
} from './AvailableVarsHelpers'

export const GetInfoModal = ({
  isOpen,
  onResolve,
  onReject,
  segName: initialSegName,
  isSegNameEditable,
  value: initialValue,
  initialVariableName,
}: {
  isOpen: boolean
  onResolve: (a: {
    value: string
    segName: string
    valueNode: Value
    variableName?: string
    newVariableInsertIndex: number
  }) => void
  onReject: (a: any) => void
  segName: string
  isSegNameEditable: boolean
  value: number
  initialVariableName: string
}) => {
  const [segName, setSegName] = useState(initialSegName)
  const [value, setValue] = useState(String(initialValue))
  const [shouldCreateVariable, setShouldCreateVariable] = useState(false)

  const {
    prevVariables,
    inputRef,
    calcResult,
    valueNode,
    setNewVariableName,
    newVariableName,
    isNewVariableNameUnique,
    newVariableInsertIndex,
  } = useCalc({ value, initialVariableName })

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
                  className="text-lg font-medium leading-6 text-gray-900"
                >
                  Constraint details
                </Dialog.Title>
                <div className="block text-sm font-medium text-gray-700 mt-3 font-mono capitalize">
                  Available Variables
                </div>
                <AvailableVars
                  prevVariables={prevVariables}
                  onVarClick={addToInputHelper(inputRef, setValue)}
                />
                <label
                  htmlFor="val"
                  className="block text-sm font-medium text-gray-700 mt-3 font-mono"
                >
                  Distance
                </label>
                <div className="mt-1">
                  <input
                    type="text"
                    name="val"
                    id="val"
                    ref={inputRef}
                    className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md font-mono"
                    value={value}
                    onChange={(e) => {
                      setValue(e.target.value)
                    }}
                  />
                </div>
                <CalcResult calcResult={calcResult} />
                <label
                  htmlFor="segName"
                  className="block text-sm font-medium text-gray-700 mt-3 font-mono"
                >
                  Segment Name
                </label>
                <div className="mt-1">
                  <input
                    type="text"
                    name="segName"
                    id="segName"
                    disabled={!isSegNameEditable}
                    className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md font-mono"
                    value={segName}
                    onChange={(e) => {
                      setSegName(e.target.value)
                    }}
                  />
                </div>
                <CreateNewVariable
                  setNewVariableName={setNewVariableName}
                  newVariableName={newVariableName}
                  isNewVariableNameUnique={isNewVariableNameUnique}
                  shouldCreateVariable={shouldCreateVariable}
                  setShouldCreateVariable={setShouldCreateVariable}
                />

                <div className="mt-4">
                  <button
                    type="button"
                    className="inline-flex justify-center rounded-md border border-transparent bg-blue-100 px-4 py-2 text-sm font-medium text-blue-900 hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                    onClick={() =>
                      valueNode &&
                      onResolve({
                        segName,
                        value,
                        valueNode,
                        newVariableInsertIndex,
                        variableName: shouldCreateVariable
                          ? newVariableName
                          : undefined,
                      })
                    }
                  >
                    Add constraining value
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
