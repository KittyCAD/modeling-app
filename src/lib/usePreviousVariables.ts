import { useModelingContext } from 'hooks/useModelingContext'
import { kclManager, useKclContext } from 'lang/KclSingleton'
import { findAllPreviousVariables } from 'lang/queryAst'
import { useEffect, useState } from 'react'

export function usePreviousVariables() {
  const { programMemory, code } = useKclContext()
  const { context } = useModelingContext()
  const selectionRange = context.selectionRanges.codeBasedSelections[0]
    ?.range || [code.length, code.length]
  const [previousVariablesInfo, setPreviousVariablesInfo] = useState<
    ReturnType<typeof findAllPreviousVariables>
  >({
    variables: [],
    insertIndex: 0,
    bodyPath: [],
  })

  useEffect(() => {
    if (!programMemory || !selectionRange) return
    const varInfo = findAllPreviousVariables(
      kclManager.ast,
      kclManager.programMemory,
      selectionRange
    )
    setPreviousVariablesInfo(varInfo)
  }, [kclManager.ast, kclManager.programMemory, selectionRange])

  return previousVariablesInfo
}
