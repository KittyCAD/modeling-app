import { findUniqueName } from '@src/lang/create'
import type { PrevVariable } from '@src/lang/queryAst'
import { findAllPreviousVariables } from '@src/lang/queryAst'
import { getSafeInsertIndex } from '@src/lang/queryAst/getSafeInsertIndex'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Expr, Program, SourceRange, VariableMap } from '@src/lang/wasm'
import { parse, resultIsOk } from '@src/lang/wasm'
import { getCalculatedKclExpressionValue } from '@src/lib/kclHelpers'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'
import { getInVariableCase } from '@src/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type RustContext from '@src/lib/rustContext'

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
  sourceRange,
  selectionRanges,
  rustContext,
  code,
  ast,
  variables,
  options,
}: {
  value: string
  initialVariableName?: string
  sourceRange?: SourceRange
  selectionRanges: Selections
  rustContext: RustContext
  code: string
  ast: Node<Program>
  variables: VariableMap
  options?: { allowArrays?: boolean }
}): {
  inputRef: React.RefObject<HTMLInputElement | null>
  valueNode: Expr | null
  calcResult: string
  prevVariables: PrevVariable<unknown>[]
  newVariableName: string
  isNewVariableNameUnique: boolean
  newVariableInsertIndex: number
  setNewVariableName: (a: string) => void
  isExecuting: boolean
} {
  // Executing the mini AST to calculate the expression value
  // is asynchronous. Use this state variable to track if execution
  // has completed
  const [isExecuting, setIsExecuting] = useState(false)
  // If there is no selection, use the end of the code
  // so all variables are available
  const selectionRange: SourceRange | undefined =
    selectionRanges.graphSelections[0]?.codeRef?.range
  // If there is no selection, use the end of the code
  // If we don't memoize this, we risk an infinite set/read state loop
  const endingSourceRange = useMemo(
    () => sourceRange || selectionRange || [code.length, code.length],
    [code, selectionRange, sourceRange]
  )
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
  const codeValueParseResult = parse(_code_value, rustContext.getRustInstance())
  let isValueParsable = true
  if (err(codeValueParseResult) || !resultIsOk(codeValueParseResult)) {
    isValueParsable = false
  }
  const initialCalcResult: number | string =
    Number.isNaN(parseFloat(value)) || !isValueParsable ? 'NAN' : value
  const [calcResult, setCalcResult] = useState(initialCalcResult)
  const [newVariableName, _setNewVariableName] = useState('')
  const [isNewVariableNameUnique, setIsNewVariableNameUnique] = useState(true)

  const setNewVariableName = useCallback(
    (value: string) => {
      const camelCaseValue = value ? getInVariableCase(value) : ''
      _setNewVariableName(camelCaseValue || '')
    },
    [_setNewVariableName]
  )

  useEffect(() => {
    setTimeout(() => {
      inputRef.current && inputRef.current.focus()
      inputRef.current &&
        inputRef.current.setSelectionRange(0, String(value).length)
    }, 100)
    setNewVariableName(findUniqueName(ast, valueName))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
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
    const varInfo = findAllPreviousVariables(ast, variables, endingSourceRange)
    setAvailableVarInfo(varInfo)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [ast, variables, endingSourceRange])

  useEffect(() => {
    const execAstAndSetResult = async () => {
      const result = await getCalculatedKclExpressionValue(
        value,
        rustContext,
        options
      )
      setIsExecuting(false)
      if (result instanceof Error || 'errors' in result || !result.astNode) {
        setCalcResult('NAN')
        setValueNode(null)
        return
      }
      const newInsertIndex = getSafeInsertIndex(result.astNode, ast)
      setInsertIndex(newInsertIndex)
      setCalcResult(result?.valueAsString || 'NAN')
      result?.astNode && setValueNode(result.astNode)
    }
    if (!value) return
    setIsExecuting(true)
    execAstAndSetResult().catch(() => {
      setCalcResult('NAN')
      setIsExecuting(false)
      setValueNode(null)
    })
  }, [value, availableVarInfo, code, rustContext, options, ast])

  return {
    valueNode,
    calcResult,
    prevVariables: availableVarInfo.variables,
    newVariableInsertIndex: insertIndex,
    newVariableName,
    isNewVariableNameUnique,
    setNewVariableName,
    inputRef,
    isExecuting,
  }
}
