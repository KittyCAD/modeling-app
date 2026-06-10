import { use, useEffect, useState } from 'react'

import {
  SetVarNameModal,
  createSetVarNameModal,
} from '@src/components/SetVarNameModal'
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { ExecutingEditor } from '@src/lang/ExecutingEditor'
import { moveValueIntoNewVariable } from '@src/lang/modifyAst'
import { isNodeSafeToReplace } from '@src/lang/queryAst'
import type { PathToNode, SourceRange } from '@src/lang/wasm'
import { recast } from '@src/lang/wasm'
import { err, reportRejection, trap } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'

export const getVarNameModal = createSetVarNameModal(SetVarNameModal)

export function useConvertToVariable(
  executingEditor: ExecutingEditor,
  range?: SourceRange
) {
  const wasmInstance = use(executingEditor.wasmInstancePromise)
  const ast = executingEditor.astSignal.value
  const { context } = useModelingContext()
  const [enable, setEnabled] = useState(false)

  useEffect(() => {
    executingEditor.convertToVariableEnabled = enable
  }, [enable, executingEditor])

  useEffect(() => {
    // Return early if there are no selection ranges for whatever reason
    if (!context.selectionRanges) return
    const parsed = ast

    const meta = isNodeSafeToReplace(
      parsed,
      range ||
        context.selectionRanges.graphSelections?.[0]?.codeRef?.range ||
        [],
      wasmInstance
    )
    if (trap(meta)) return

    const { isSafe, value } = meta
    const canReplace = isSafe && value.type !== 'Name'
    const isOnlyOneSelection =
      !!range || context.selectionRanges.graphSelections.length === 1

    setEnabled(canReplace && isOnlyOneSelection)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [context.selectionRanges])

  const handleClick = async (
    valueName?: string
  ): Promise<PathToNode | undefined> => {
    try {
      const { variableName } = await getVarNameModal({
        valueName: valueName || 'var',
        selectionRanges: context.selectionRanges,
      })

      const { modifiedAst: _modifiedAst, pathToReplacedNode } =
        moveValueIntoNewVariable(
          ast,
          executingEditor.variables,
          range || context.selectionRanges.graphSelections[0]?.codeRef?.range,
          variableName,
          wasmInstance
        )

      await executingEditor.updateAst(_modifiedAst, true)

      const newCode = recast(
        _modifiedAst,
        await executingEditor.wasmInstancePromise
      )
      if (err(newCode)) return
      executingEditor.updateCodeEditor(newCode)

      return pathToReplacedNode
    } catch (e) {
      console.log('error', e)
    }
  }

  executingEditor.convertToVariableCallback = toSync(
    handleClick,
    reportRejection
  )

  return { enable, handleClick }
}
