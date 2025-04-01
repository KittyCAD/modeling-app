import { Dialog, Transition } from '@headlessui/react'
import { useCalculateKclExpression } from 'lib/useCalculateKclExpression'
import { Fragment, useState } from 'react'
import { type InstanceProps, create } from 'react-modal-promise'

import { Expr } from '../lang/wasm'
import {
  AvailableVars,
  CalcResult,
  CreateNewVariable,
  addToInputHelper,
} from './AvailableVarsHelpers'

type ModalResolve = {
  value: string
  sign: number
  valueNode: Expr
  variableName?: string
  newVariableInsertIndex: number
}

type ModalReject = boolean

type SetAngleLengthModalProps = InstanceProps<ModalResolve, ModalReject> & {
  value: number
  valueName: string
  shouldCreateVariable?: boolean
}

export const createSetAngleLengthModal = create<
  SetAngleLengthModalProps,
  ModalResolve,
  ModalReject
>

export const SetAngleLengthModal = ({
  isOpen,
  onResolve,
  onReject,
  value: initialValue,
  valueName,
  shouldCreateVariable: initialShouldCreateVariable = false,
}: SetAngleLengthModalProps) => {
  const [sign, setSign] = useState(Math.sign(Number(initialValue)))
  const [value, setValue] = useState(String(initialValue * sign))
  const [shouldCreateVariable, setShouldCreateVariable] = useState(
    initialShouldCreateVariable
  )

  const {
    prevVariables,
    calcResult,
    valueNode,
    isNewVariableNameUnique,
    newVariableName,
    setNewVariableName,
    inputRef,
    newVariableInsertIndex,
  } = useCalculateKclExpression({
    value,
    initialVariableName: valueName,
  })

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
                <div className="block text-sm font-medium text-gray-700 mt-3 font-mono capitalize">
                  Available Variables
                </div>
                <AvailableVars
                  prevVariables={prevVariables}
                  onVarClick={addToInputHelper(inputRef, setValue)}
                />
                <label
                  htmlFor="val"
                  className="block text-sm font-medium text-gray-700 mt-3 font-mono capitalize"
                >
                  {valueName} Value
                </label>
                <div className="mt-1 flex">
                  <button
                    className="border border-gray-300 px-2 text-gray-900"
                    onClick={() => setSign(-sign)}
                  >
                    {sign > 0 ? '+' : '-'}
                  </button>
                  <input
                    ref={inputRef}
                    type="text"
                    name="val"
                    id="val"
                    className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md font-mono pl-1 text-gray-900"
                    value={value}
                    onChange={(e) => {
                      setValue(e.target.value)
                    }}
                  />
                </div>
                <CalcResult calcResult={calcResult} />
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
                    disabled={calcResult === 'NAN' || !isNewVariableNameUnique}
                    className={`inline-flex justify-center rounded-md border border-transparent bg-blue-100 px-4 py-2 text-sm font-medium text-blue-900 hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                      calcResult === 'NAN' || !isNewVariableNameUnique
                        ? 'opacity-50 cursor-not-allowed'
                        : ''
                    }`}
                    onClick={() =>
                      valueNode &&
                      onResolve({
                        value,
                        sign,
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
