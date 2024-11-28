import { useModelingContext } from 'hooks/useModelingContext'
import { kclManager, engineCommandManager } from 'lib/singletons'
import { useKclContext } from 'lang/KclProvider'
import { findUniqueName } from 'lang/modifyAst'
import { PrevVariable, findAllPreviousVariables } from 'lang/queryAst'
import { ProgramMemory, Expr, parse } from 'lang/wasm'
import { useEffect, useRef, useState } from 'react'
import { executeAst } from 'lang/langHelpers'
import { err, trap } from 'lib/trap'

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
  const { programMemory, code } = useKclContext()
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
    if (
      programMemory.has(newVariableName) ||
      newVariableName === '' ||
      !isValidVariableName(newVariableName)
    ) {
      setIsNewVariableNameUnique(false)
    } else {
      setIsNewVariableNameUnique(true)
    }
  }, [programMemory, newVariableName])

  useEffect(() => {
    if (!programMemory) return
    const varInfo = findAllPreviousVariables(
      kclManager.ast,
      kclManager.programMemory,
      // If there is no selection, use the end of the code
      selectionRange || [code.length, code.length]
    )
    setAvailableVarInfo(varInfo)
  }, [kclManager.ast, kclManager.programMemory, selectionRange])

  useEffect(() => {
    const execAstAndSetResult = async () => {
      const _code = `const __result__ = ${value}`
      const pResult = parse(_code)
      if (err(pResult) || !pResult.program || pResult.errors.length > 0) return
      const ast = pResult.program

      const _programMem: ProgramMemory = ProgramMemory.empty()
      for (const { key, value } of availableVarInfo.variables) {
        const error = _programMem.set(key, {
          type: 'String',
          value,
          __meta: [],
        })
        if (trap(error, { suppress: true })) return
      }
      const { execState } = await executeAst({
        ast,
        engineCommandManager,
        useFakeExecutor: true,
        programMemoryOverride: kclManager.programMemory.clone(),
        idGenerator: kclManager.execState.idGenerator,
      })
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
    }
    if (!value) return
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
