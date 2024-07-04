import { useModelingContext } from 'hooks/useModelingContext'
import { kclManager, engineCommandManager } from 'lib/singletons'
import { useKclContext } from 'lang/KclProvider'
import { findUniqueName } from 'lang/modifyAst'
import { PrevVariable, findAllPreviousVariables } from 'lang/queryAst'
import { Value, parse } from 'lang/wasm'
import { useEffect, useRef, useState } from 'react'
import { executeAst } from 'lang/langHelpers'
import { trap } from 'lib/trap'

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
  valueNode: Value | null
  calcResult: string
  prevVariables: PrevVariable<unknown>[]
  newVariableName: string
  isNewVariableNameUnique: boolean
  newVariableInsertIndex: number
  setNewVariableName: (a: string) => void
} {
  const { programMemory, code } = useKclContext()
  const { context } = useModelingContext()
  const selectionRange:
    | (typeof context.selectionRanges.codeBasedSelections)[number]['range']
    | undefined = context.selectionRanges.codeBasedSelections[0]?.range
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
    if (
      allVarNames.includes(newVariableName) ||
      newVariableName === '' ||
      !isValidVariableName(newVariableName)
    ) {
      setIsNewVariableNameUnique(false)
    } else {
      setIsNewVariableNameUnique(true)
    }
  }, [programMemory, newVariableName])

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
      const _code = `const __result__ = ${value}`
      const ast = parse(_code)
      if (trap(ast, { suppress: true })) return

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
  }, [value, availableVarInfo, code, kclManager.programMemory])

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
