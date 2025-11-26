import { useEffect, useMemo, useState } from 'react'

import { useModelingContext } from '@src/hooks/useModelingContext'
import { findAllPreviousVariables } from '@src/lang/queryAst'
import { kclManager } from '@src/lib/singletons'

export function usePreviousVariables({ code }: { code: string }) {
  const ast = kclManager.astSignal.value
  const variables = kclManager.variablesSignal.value
  const { context } = useModelingContext()
  const selectionFromContext =
    context.selectionRanges.graphSelections[0]?.codeRef?.range
  const selectionRange = useMemo(
    () => selectionFromContext || [code.length, code.length],
    [selectionFromContext, code]
  )
  const [previousVariablesInfo, setPreviousVariablesInfo] = useState<
    ReturnType<typeof findAllPreviousVariables>
  >({
    variables: [],
    insertIndex: 0,
    bodyPath: [],
  })

  useEffect(() => {
    if (!variables || !selectionRange) return
    const varInfo = findAllPreviousVariables(ast, variables, selectionRange)
    setPreviousVariablesInfo(varInfo)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [ast, variables, selectionRange])

  return previousVariablesInfo
}
