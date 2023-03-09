import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useState, useRef, useEffect } from 'react'
import { abstractSyntaxTree, Value } from '../lang/abstractSyntaxTree'
import { executor } from '../lang/executor'
import { findUniqueName } from '../lang/modifyAst'
import { PrevVariable } from '../lang/queryAst'
import { lexer } from '../lang/tokeniser'
import { useStore } from '../useStore'

export const SetAngleLengthModal = ({
  isOpen,
  onResolve,
  onReject,
  prevVariables,
  value: initialValue,
  valueName,
}: {
  isOpen: boolean
  onResolve: (a: {
    value: string
    valueNode: Value
    variableName?: string
  }) => void
  onReject: (a: any) => void
  prevVariables: PrevVariable<number>[]
  value: number
  valueName: string
}) => {
  const { ast, programMemory } = useStore((s) => ({
    ast: s.ast,
    programMemory: s.programMemory,
  }))
  const [value, setValue] = useState(String(initialValue))
  const [calcResult, setCalcResult] = useState('NAN')
  const [shouldCreateVariable, setShouldCreateVariable] = useState(false)
  const [newVariableName, setNewVariableName] = useState('')
  const [isNewVariableNameUnique, setIsNewVariableNameUnique] = useState(true)
  const [valueNode, setValueNode] = useState<any>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setTimeout(() => {
      inputRef.current && inputRef.current.focus()
      inputRef.current &&
        inputRef.current.setSelectionRange(0, String(value).length)
    }, 100)
    if (ast) {
      setNewVariableName(findUniqueName(ast, valueName))
    }
  }, [])

  useEffect(() => {
    const allVarNames = Object.keys(programMemory.root)
    if (allVarNames.includes(newVariableName)) {
      setIsNewVariableNameUnique(false)
    } else {
      setIsNewVariableNameUnique(true)
    }
  }, [newVariableName])

  useEffect(() => {
    try {
      const code = `const __result__ = ${value}\nshow(__result__)`
      const ast = abstractSyntaxTree(lexer(code))
      const _programMem: any = { root: {} }
      prevVariables.forEach(({ key, value }) => {
        _programMem.root[key] = { type: 'userVal', value, __meta: [] }
      })
      const programMemory = executor(ast, _programMem)
      const resultDeclaration = ast.body.find(
        (a) =>
          a.type === 'VariableDeclaration' &&
          a.declarations?.[0]?.id?.name === '__result__'
      )
      const init =
        resultDeclaration?.type === 'VariableDeclaration' &&
        resultDeclaration?.declarations?.[0]?.init
      console.log(init)
      setCalcResult(programMemory?.root?.__result__?.value || 'NAN')
      setValueNode(init)
    } catch (e) {
      setCalcResult('NAN')
      setValueNode(null)
    }
  }, [value])

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
                <ul className="flex flex-col">
                  {prevVariables.length &&
                    prevVariables.map(({ key, value }) => (
                      <li key={key}>
                        <button
                          className="flex w-full justify-between items-center rounded-md hover:bg-gray-100 max-w-xs"
                          onClick={(e) => {
                            const selectionStart =
                              inputRef.current?.selectionStart
                            let selectionEnd = inputRef.current?.selectionEnd
                            let newValue = ''
                            if (
                              typeof selectionStart === 'number' &&
                              typeof selectionEnd === 'number'
                            ) {
                              newValue = stringSplice(
                                inputRef.current?.value || '',
                                selectionStart,
                                selectionEnd,
                                key
                              )
                              selectionEnd = selectionStart + key.length
                            } else {
                              newValue = inputRef.current?.value + key
                            }
                            setValue(newValue)
                            inputRef.current?.focus()
                            setTimeout(() => {
                              // run in the next render cycle
                              const _selectionEnd =
                                typeof selectionEnd === 'number'
                                  ? selectionEnd
                                  : newValue.length
                              inputRef.current?.setSelectionRange(
                                _selectionEnd,
                                _selectionEnd
                              )
                            })
                          }}
                        >
                          <span className="font-[monospace] text-gray-800">
                            {key}
                          </span>{' '}
                          <span className="font-[monospace] text-gray-600 w-24 text-start font-bold">
                            {value}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
                <label
                  htmlFor="val"
                  className="block text-sm font-medium text-gray-700 mt-3 font-mono capitalize"
                >
                  {valueName} Value
                </label>
                <div className="mt-1">
                  <input
                    ref={inputRef}
                    type="text"
                    name="val"
                    id="val"
                    className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md font-mono pl-1"
                    value={value}
                    onChange={(e) => {
                      setValue(e.target.value)
                    }}
                  />
                </div>
                <div className="font-[monospace] pl-4 text-gray-600">
                  <span
                    className={`${
                      calcResult === 'NAN' ? 'bg-pink-200' : ''
                    } px-2 py-0.5 rounded`}
                  >
                    = {calcResult}
                  </span>
                </div>

                <label
                  htmlFor="val"
                  className="block text-sm font-medium text-gray-700 mt-3 font-mono"
                >
                  Create new variable
                </label>
                <div className="mt-1 flex flex-1">
                  <input
                    type="checkbox"
                    name="val"
                    id="val"
                    className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md font-mono pl-1 flex-shrink"
                    checked={shouldCreateVariable}
                    onChange={(e) => {
                      setShouldCreateVariable(e.target.checked)
                    }}
                  />
                  <input
                    type="text"
                    disabled={!shouldCreateVariable}
                    name="val"
                    id="val"
                    className={`shadow-sm font-[monospace] focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md font-mono pl-1 flex-shrink-0 ${
                      !shouldCreateVariable ? 'opacity-50' : ''
                    }`}
                    value={newVariableName}
                    onChange={(e) => {
                      setNewVariableName(e.target.value)
                    }}
                  />
                </div>
                {!isNewVariableNameUnique && (
                  <div className="bg-pink-200 rounded px-2 py-0.5 text-xs">
                    Sorry, that's not a unique variable name. Please try
                    something else
                  </div>
                )}

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
                      onResolve({
                        value,
                        valueNode,
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

function stringSplice(str: string, index: number, count: number, add: string) {
  return str.slice(0, index) + (add || '') + str.slice(index + count)
}
