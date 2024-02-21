import { useModelingContext } from 'hooks/useModelingContext'
import { kclManager, useKclContext } from 'lang/KclSingleton'
import { findUniqueName } from 'lang/modifyAst'
import { PrevVariable, findAllPreviousVariables } from 'lang/queryAst'
import { engineCommandManager } from '../lang/std/engineConnection'
import { Value, parse } from 'lang/wasm'
import { useEffect, useRef, useState } from 'react'
import { executeAst } from 'useStore'

/**
 * Given a value and a possible variablename,
 * return helpers for calculating the value and inserting it into the code
 * as well as information about the variables that are available
 */
export function useCalculateKclExpression({
  value,
  initialVariableName: valueName = '',
}: {
  value: string
  initialVariableName?: string
}): {
  inputRef: React.RefObject<HTMLInputElement>
  valueNode: Value | null
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
  const [valueNode, setValueNode] = useState<Value | null>(null)
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
    const allVarNames = Object.keys(programMemory.root)
    if (allVarNames.includes(newVariableName)) {
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
    const execAstAndSetResult = async () => {
      const code = `const __result__ = ${value}`
      const ast = parse(code)
      const _programMem: any = { root: {}, return: null }
      availableVarInfo.variables.forEach(({ key, value }) => {
        _programMem.root[key] = { type: 'userVal', value, __meta: [] }
      })
      const { programMemory } = await executeAst({
        ast,
        engineCommandManager,
        useFakeExecutor: true,
        programMemoryOverride: JSON.parse(
          JSON.stringify(kclManager.programMemory)
        ),
      })
      const resultDeclaration = ast.body.find(
        (a) =>
          a.type === 'VariableDeclaration' &&
          a.declarations?.[0]?.id?.name === '__result__'
      )
      const init =
        resultDeclaration?.type === 'VariableDeclaration' &&
        resultDeclaration?.declarations?.[0]?.init
      const result = programMemory?.root?.__result__?.value
      setCalcResult(typeof result === 'number' ? String(result) : 'NAN')
      init && setValueNode(init)
    }
    execAstAndSetResult().catch(() => {
      setCalcResult('NAN')
      setValueNode(null)
    })
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
