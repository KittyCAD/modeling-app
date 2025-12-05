import { useEffect, useState } from 'react'

import {
  SetVarNameModal,
  createSetVarNameModal,
} from '@src/components/SetVarNameModal'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { moveValueIntoNewVariable } from '@src/lang/modifyAst'
import { isNodeSafeToReplace } from '@src/lang/queryAst'
import type { PathToNode, SourceRange } from '@src/lang/wasm'
import { recast } from '@src/lang/wasm'
import type { KclManager } from '@src/lang/KclManager'
import { err, reportRejection, trap } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'

export const getVarNameModal = createSetVarNameModal(SetVarNameModal)

export function useConvertToVariable(
  kclManager: KclManager,
  range?: SourceRange
) {
  const ast = kclManager.astSignal.value
  const { context } = useModelingContext()
  const [enable, setEnabled] = useState(false)

  useEffect(() => {
    kclManager.convertToVariableEnabled = enable
  }, [enable, kclManager])

  useEffect(() => {
    // Return early if there are no selection ranges for whatever reason
    if (!context.selectionRanges) return
    const parsed = ast

    const meta = isNodeSafeToReplace(
      parsed,
      range ||
        context.selectionRanges.graphSelections?.[0]?.codeRef?.range ||
        []
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
          kclManager.variables,
          range || context.selectionRanges.graphSelections[0]?.codeRef?.range,
          variableName
        )

      await kclManager.updateAst(_modifiedAst, true)

      const newCode = recast(_modifiedAst)
      if (err(newCode)) return
      kclManager.updateCodeEditor(newCode)

      return pathToReplacedNode
    } catch (e) {
      console.log('error', e)
    }
  }

  kclManager.convertToVariableCallback = toSync(handleClick, reportRejection)

  return { enable, handleClick }
}
