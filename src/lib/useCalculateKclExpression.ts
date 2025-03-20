import { useModelingContext } from 'hooks/useModelingContext'
import { kclManager } from 'lib/singletons'
import { useKclContext } from 'lang/KclProvider'
import { findUniqueName } from 'lang/modifyAst'
import { PrevVariable, findAllPreviousVariables } from 'lang/queryAst'
import { Expr } from 'lang/wasm'
import { useEffect, useRef, useState } from 'react'
import { getCalculatedKclExpressionValue } from './kclHelpers'
import { parse, resultIsOk } from 'lang/wasm'
import { err } from 'lib/trap'
import { getSafeInsertIndex } from 'lang/queryAst/getSafeInsertIndex'

const isValidVariableName = (name: string) =>
  /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)

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
  valueNode: Expr | null
  calcResult: string
  prevVariables: PrevVariable<unknown>[]
  newVariableName: string
  isNewVariableNameUnique: boolean
  newVariableInsertIndex: number
  setNewVariableName: (a: string) => void
} {
  const { variables, code } = useKclContext()
  const { context } = useModelingContext()
  // If there is no selection, use the end of the code
  // so all variables are available
  const selectionRange:
    | (typeof context)['selectionRanges']['graphSelections'][number]['codeRef']['range']
    | undefined = context.selectionRanges.graphSelections[0]?.codeRef?.range
  const inputRef = useRef<HTMLInputElement>(null)
  const [availableVarInfo, setAvailableVarInfo] = useState<
    ReturnType<typeof findAllPreviousVariables>
  >({
    variables: [],
    insertIndex: 0,
    bodyPath: [],
  })
  const [insertIndex, setInsertIndex] = useState(0)
  const [valueNode, setValueNode] = useState<Expr | null>(null)
  // Gotcha: If we do not attempt to parse numeric literals instantly it means that there is an async action to verify
  // the value is good. This means all E2E tests have a race condition on when they can hit "next" in the command bar.
  // Most scenarios automatically pass a numeric literal. We can try to parse that first, otherwise make it go through the slow
  // async method.
  // If we pass in numeric literals, we should instantly parse them, they have nothing to do with application memory
  const _code_value = `const __result__ = ${value}`
  const codeValueParseResult = parse(_code_value)
  let isValueParsable = true
  if (err(codeValueParseResult) || !resultIsOk(codeValueParseResult)) {
    isValueParsable = false
  }
  const initialCalcResult: number | string =
    Number.isNaN(Number(value)) || !isValueParsable ? 'NAN' : value
  const [calcResult, setCalcResult] = useState(initialCalcResult)
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
    if (
      variables[newVariableName] ||
      newVariableName === '' ||
      !isValidVariableName(newVariableName)
    ) {
      setIsNewVariableNameUnique(false)
    } else {
      setIsNewVariableNameUnique(true)
    }
  }, [variables, newVariableName])

  useEffect(() => {
    if (!variables) return
    const varInfo = findAllPreviousVariables(
      kclManager.ast,
      kclManager.variables,
      // If there is no selection, use the end of the code
      selectionRange || [code.length, code.length]
    )
    setAvailableVarInfo(varInfo)
  }, [kclManager.ast, kclManager.variables, selectionRange])

  useEffect(() => {
    const execAstAndSetResult = async () => {
      const result = await getCalculatedKclExpressionValue(value)
      if (result instanceof Error || 'errors' in result || !result.astNode) {
        setCalcResult('NAN')
        setValueNode(null)
        return
      }
      const newInsertIndex = getSafeInsertIndex(result.astNode, kclManager.ast)
      setInsertIndex(newInsertIndex)
      setCalcResult(result?.valueAsString || 'NAN')
      result?.astNode && setValueNode(result.astNode)
    }
    if (!value) return
    execAstAndSetResult().catch(() => {
      setCalcResult('NAN')
      setValueNode(null)
    })
  }, [value, availableVarInfo, code, kclManager.variables])

  return {
    valueNode,
    calcResult,
    prevVariables: availableVarInfo.variables,
    newVariableInsertIndex: insertIndex,
    newVariableName,
    isNewVariableNameUnique,
    setNewVariableName,
    inputRef,
  }
}
