import { useEffect, useState } from 'react'

import { useModelingContext } from '@src/hooks/useModelingContext'
import { useKclContext } from '@src/lang/KclProvider'
import { findAllPreviousVariables } from '@src/lang/queryAst'
import { kclManager } from '@src/lib/singletons'

export function usePreviousVariables({ code }: { code: string }) {
  const { variables } = useKclContext()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager.ast, kclManager.variables, selectionRange])

  return previousVariablesInfo
}
