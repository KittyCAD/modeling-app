import {
  SetVarNameModal,
  createSetVarNameModal,
} from 'components/SetVarNameModal'
import { editorManager, kclManager } from 'lib/singletons'
import { reportRejection, trap } from 'lib/trap'
import { moveValueIntoNewVariable } from 'lang/modifyAst'
import { isNodeSafeToReplace } from 'lang/queryAst'
import { useEffect, useState } from 'react'
import { useModelingContext } from './useModelingContext'
import { PathToNode, SourceRange } from 'lang/wasm'
import { useKclContext } from 'lang/KclProvider'
import { toSync } from 'lib/utils'
import { convertSelectionsToOld } from 'lib/selections'

export const getVarNameModal = createSetVarNameModal(SetVarNameModal)

export function useConvertToVariable(range?: SourceRange) {
  const { ast } = useKclContext()
  const { context } = useModelingContext()
  const [enable, setEnabled] = useState(false)

  useEffect(() => {
    editorManager.convertToVariableEnabled = enable
  }, [enable])

  useEffect(() => {
    const parsed = ast

    const meta = isNodeSafeToReplace(
      parsed,
      range ||
        convertSelectionsToOld(context.selectionRanges).codeBasedSelections?.[0]
          ?.range ||
        []
    )
    if (trap(meta)) return

    const { isSafe, value } = meta
    const canReplace = isSafe && value.type !== 'Identifier'
    const isOnlyOneSelection =
      !!range ||
      convertSelectionsToOld(context.selectionRanges).codeBasedSelections
        .length === 1

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
          kclManager.programMemory,
          range ||
            convertSelectionsToOld(context.selectionRanges)
              .codeBasedSelections[0].range,
          variableName
        )

      await kclManager.updateAst(_modifiedAst, true)
      return pathToReplacedNode
    } catch (e) {
      console.log('error', e)
    }
  }

  editorManager.convertToVariableCallback = toSync(handleClick, reportRejection)

  return { enable, handleClick }
}
