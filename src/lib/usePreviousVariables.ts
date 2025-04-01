import { useModelingContext } from 'hooks/useModelingContext'
import { useKclContext } from 'lang/KclProvider'
import { findAllPreviousVariables } from 'lang/queryAst'
import { kclManager } from 'lib/singletons'
import { useEffect, useState } from 'react'

export function usePreviousVariables() {
  const { variables, code } = useKclContext()
  const { context } = useModelingContext()
  const selectionRange = context.selectionRanges.graphSelections[0]?.codeRef
    ?.range || [code.length, code.length]
  const [previousVariablesInfo, setPreviousVariablesInfo] = useState<
    ReturnType<typeof findAllPreviousVariables>
  >({
    variables: [],
    insertIndex: 0,
    bodyPath: [],
  })

  useEffect(() => {
    if (!variables || !selectionRange) return
    const varInfo = findAllPreviousVariables(
      kclManager.ast,
      kclManager.variables,
      selectionRange
    )
    setPreviousVariablesInfo(varInfo)
  }, [kclManager.ast, kclManager.variables, selectionRange])

  return previousVariablesInfo
}
