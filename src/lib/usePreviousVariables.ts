import { useEffect, useState } from 'react'

import { useModelingContext } from '@src/hooks/useModelingContext'
import { findAllPreviousVariables } from '@src/lang/queryAst'
import type { Program, VariableMap } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export function usePreviousVariables({
  ast,
  variables,
  wasmInstance,
}: {
  ast: Program
  variables: VariableMap
  wasmInstance: ModuleType
}) {
  const { context } = useModelingContext()
  const selectionRange =
    context.selectionRanges.graphSelections[0]?.codeRef?.range
  const [previousVariablesInfo, setPreviousVariablesInfo] = useState<
    ReturnType<typeof findAllPreviousVariables>
  >({
    variables: [],
    insertIndex: 0,
    bodyPath: [],
  })

  useEffect(() => {
    if (!variables) return
    const varInfo = findAllPreviousVariables(
      ast,
      variables,
      selectionRange,
      wasmInstance
    )
    setPreviousVariablesInfo(varInfo)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [ast, variables, selectionRange])

  return previousVariablesInfo
}
