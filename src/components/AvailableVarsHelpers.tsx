import { useEffect, useState, useRef } from 'react'
import { parse, BinaryPart, Expr, ProgramMemory } from '../lang/wasm'
import {
  createIdentifier,
  createLiteral,
  createUnaryExpression,
  findUniqueName,
} from '../lang/modifyAst'
import { findAllPreviousVariables, PrevVariable } from '../lang/queryAst'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { useKclContext } from 'lang/KclProvider'
import { useModelingContext } from 'hooks/useModelingContext'
import { executeAst } from 'lang/langHelpers'
import { trap } from 'lib/trap'

export const AvailableVars = ({
  onVarClick,
  prevVariables,
}: {
  onVarClick: (a: string) => void
  prevVariables: PrevVariable<any>[]
}) => {
  return (
    <ul className="flex flex-col">
      {prevVariables.length &&
        prevVariables.map(({ key, value }) => (
          <li key={key}>
            <button
              className="flex w-full justify-between items-center rounded-md hover:bg-gray-100 max-w-xs"
              onClick={() => onVarClick(key)}
            >
              <span className="font-[monospace] text-gray-800">{key}</span>{' '}
              <span className="font-[monospace] text-gray-600 w-24 text-start font-bold">
                {value}
              </span>
            </button>
          </li>
        ))}
    </ul>
  )
}

export const addToInputHelper =
  (
    inputRef: React.RefObject<HTMLInputElement>,
    setValue: (a: string) => void
  ) =>
  (varName: string) => {
    const selectionStart = inputRef.current?.selectionStart
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
        varName
      )
      selectionEnd = selectionStart + varName.length
    } else {
      newValue = inputRef.current?.value + varName
    }
    setValue(newValue)
    inputRef.current?.focus()
    setTimeout(() => {
      // run in the next render cycle
      const _selectionEnd =
        typeof selectionEnd === 'number' ? selectionEnd : newValue.length
      inputRef.current?.setSelectionRange(_selectionEnd, _selectionEnd)
    })
  }

function stringSplice(str: string, index: number, count: number, add: string) {
  return str.slice(0, index) + (add || '') + str.slice(index + count)
}

// what a terriable name
export function useCalc({
  value,
  initialVariableName: valueName = '',
}: {
  value: string
  initialVariableName?: string
}): {
  inputRef: React.RefObject<HTMLInputElement>
  valueNode: Expr | null
  calcResult: string
  prevVariables: PrevVariable<unknown>[]
  newVariableName: string
  isNewVariableNameUnique: boolean
  newVariableInsertIndex: number
  setNewVariableName: (a: string) => void
} {
  const { programMemory } = useKclContext()
  const { context } = useModelingContext()
  const selectionRange = context.selectionRanges.codeBasedSelections[0].range
  const inputRef = useRef<HTMLInputElement>(null)
  const [availableVarInfo, setAvailableVarInfo] = useState<
    ReturnType<typeof findAllPreviousVariables>
  >({
    variables: [],
    insertIndex: 0,
    bodyPath: [],
  })
  const [valueNode, setValueNode] = useState<Expr | null>(null)
  const [calcResult, setCalcResult] = useState('NAN')
  const [newVariableName, setNewVariableName] = useState('')
  const [isNewVariableNameUnique, setIsNewVariableNameUnique] = useState(true)

  useEffect(() => {
    setTimeout(() => {
      inputRef.current && inputRef.current.focus()
      inputRef.current &&
        inputRef.current.setSelectionRange(0, String(value).length)
    }, 100)
    setNewVariableName(findUniqueName(kclManager.ast, valueName))
  }, [])

  useEffect(() => {
    if (programMemory.has(newVariableName)) {
      setIsNewVariableNameUnique(false)
    } else {
      setIsNewVariableNameUnique(true)
    }
  }, [newVariableName])

  useEffect(() => {
    if (!programMemory || !selectionRange) return
    const varInfo = findAllPreviousVariables(
      kclManager.ast,
      kclManager.programMemory,
      selectionRange
    )
    setAvailableVarInfo(varInfo)
  }, [kclManager.ast, kclManager.programMemory, selectionRange])

  useEffect(() => {
    try {
      const code = `const __result__ = ${value}`
      const ast = parse(code)
      if (trap(ast)) return
      const _programMem: ProgramMemory = ProgramMemory.empty()
      for (const { key, value } of availableVarInfo.variables) {
        const error = _programMem.set(key, {
          type: 'UserVal',
          value,
          __meta: [],
        })
        if (trap(error)) return
      }
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      executeAst({
        ast,
        engineCommandManager,
        useFakeExecutor: true,
        programMemoryOverride: kclManager.programMemory.clone(),
      }).then(({ execState }) => {
        const resultDeclaration = ast.body.find(
          (a) =>
            a.type === 'VariableDeclaration' &&
            a.declarations?.[0]?.id?.name === '__result__'
        )
        const init =
          resultDeclaration?.type === 'VariableDeclaration' &&
          resultDeclaration?.declarations?.[0]?.init
        const result = execState.memory?.get('__result__')?.value
        setCalcResult(typeof result === 'number' ? String(result) : 'NAN')
        init && setValueNode(init)
      })
    } catch (e) {
      setCalcResult('NAN')
      setValueNode(null)
    }
  }, [value, availableVarInfo])

  return {
    valueNode,
    calcResult,
    prevVariables: availableVarInfo.variables,
    newVariableInsertIndex: availableVarInfo.insertIndex,
    newVariableName,
    isNewVariableNameUnique,
    setNewVariableName,
    inputRef,
  }
}

export const CalcResult = ({ calcResult }: { calcResult: string }) => {
  return (
    <div className="font-[monospace] pl-4 text-gray-600">
      <span
        className={`${
          calcResult === 'NAN' ? 'bg-pink-200' : ''
        } px-2 py-0.5 rounded`}
      >
        = {calcResult}
      </span>
    </div>
  )
}

export const CreateNewVariable = ({
  newVariableName,
  isNewVariableNameUnique,
  setNewVariableName,
  shouldCreateVariable,
  setShouldCreateVariable = () => {},
  showCheckbox = true,
}: {
  isNewVariableNameUnique: boolean
  newVariableName: string
  setNewVariableName: (a: string) => void
  shouldCreateVariable?: boolean
  setShouldCreateVariable?: (a: boolean) => void
  showCheckbox?: boolean
}) => {
  return (
    <>
      <label
        htmlFor="create-new-variable"
        className="block mt-3 font-mono text-chalkboard-90"
      >
        Create new variable
      </label>
      <div className="mt-1 flex gap-2 items-center">
        {showCheckbox && (
          <input
            type="checkbox"
            data-testid="create-new-variable-checkbox"
            checked={shouldCreateVariable}
            onChange={(e) => {
              setShouldCreateVariable(e.target.checked)
            }}
            className="bg-chalkboard-10 dark:bg-chalkboard-80"
          />
        )}
        <input
          type="text"
          disabled={!shouldCreateVariable}
          name="create-new-variable"
          id="create-new-variable"
          autoFocus={true}
          autoCapitalize="off"
          autoCorrect="off"
          className={`font-mono flex-1 sm:text-sm px-2 py-1 rounded-sm bg-chalkboard-10 dark:bg-chalkboard-90 text-chalkboard-90 dark:text-chalkboard-10 ${
            !shouldCreateVariable ? 'opacity-50' : ''
          }`}
          value={newVariableName}
          onChange={(e) => {
            setNewVariableName(e.target.value)
          }}
        />
      </div>
      {!isNewVariableNameUnique && (
        <div className="bg-pink-200 dark:bg-chalkboard-80 dark:text-pink-200 rounded px-2 py-0.5 text-xs">
          Sorry, that's not a unique variable name. Please try something else
        </div>
      )}
    </>
  )
}

export function removeDoubleNegatives(
  valueNode: BinaryPart,
  sign: number,
  variableName?: string
): BinaryPart {
  let finValue: BinaryPart = variableName
    ? createIdentifier(variableName)
    : valueNode
  if (sign === -1) finValue = createUnaryExpression(finValue)
  if (
    finValue.type === 'UnaryExpression' &&
    finValue.operator === '-' &&
    finValue.argument.type === 'UnaryExpression' &&
    finValue.argument.operator === '-'
  ) {
    finValue = finValue.argument.argument
  }
  if (
    finValue.type === 'UnaryExpression' &&
    finValue.operator === '-' &&
    finValue.argument.type === 'Literal' &&
    typeof finValue.argument.value === 'number' &&
    finValue.argument.value < 0
  ) {
    finValue = createLiteral(-finValue.argument.value)
  }
  return finValue
}
