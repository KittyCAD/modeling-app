import {
  SetVarNameModal,
  createSetVarNameModal,
} from 'components/SetVarNameModal'
import { editorManager, kclManager, codeManager } from 'lib/singletons'
import { reportRejection, trap, err } from 'lib/trap'
import { moveValueIntoNewVariable } from 'lang/modifyAst'
import { isNodeSafeToReplace } from 'lang/queryAst'
import { useEffect, useState } from 'react'
import { useModelingContext } from './useModelingContext'
import { PathToNode, SourceRange, recast } from 'lang/wasm'
import { useKclContext } from 'lang/KclProvider'
import { toSync } from 'lib/utils'

export const getVarNameModal = createSetVarNameModal(SetVarNameModal)

export function useConvertToVariable(range?: SourceRange) {
  const { ast } = useKclContext()
  const { context } = useModelingContext()
  const [enable, setEnabled] = useState(false)

  useEffect(() => {
    editorManager.convertToVariableEnabled = enable
  }, [enable])

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
    const canReplace = isSafe && value.type !== 'Identifier'
    const isOnlyOneSelection =
      !!range || context.selectionRanges.graphSelections.length === 1

    setEnabled(canReplace && isOnlyOneSelection)
  }, [context.selectionRanges])

  const handleClick = async (
    valueName?: string
  ): Promise<PathToNode | undefined> => {
    try {
      const { variableName } = await getVarNameModal({
        valueName: valueName || 'var',
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
      codeManager.updateCodeEditor(newCode)

      return pathToReplacedNode
    } catch (e) {
      console.log('error', e)
    }
  }

  editorManager.convertToVariableCallback = toSync(handleClick, reportRejection)

  return { enable, handleClick }
}
