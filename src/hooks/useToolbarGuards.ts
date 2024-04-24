import {
  SetVarNameModal,
  createSetVarNameModal,
} from 'components/SetVarNameModal'
import { editorManager, kclManager } from 'lib/singletons'
import { moveValueIntoNewVariable } from 'lang/modifyAst'
import { isNodeSafeToReplace } from 'lang/queryAst'
import { useEffect, useState } from 'react'
import { useModelingContext } from './useModelingContext'
import { SourceRange, parse, recast } from 'lang/wasm'
import { useKclContext } from 'lang/KclProvider'

const getModalInfo = createSetVarNameModal(SetVarNameModal)

export function useConvertToVariable(range?: SourceRange) {
  const { ast } = useKclContext()
  const { context } = useModelingContext()
  const [enable, setEnabled] = useState(false)

  useEffect(() => {
    editorManager.convertToVariableEnabled = enable
  }, [enable])

  useEffect(() => {
    const { isSafe, value } = isNodeSafeToReplace(
      parse(recast(ast)),
      range || context.selectionRanges.codeBasedSelections?.[0]?.range || []
    )
    const canReplace = isSafe && value.type !== 'Identifier'
    const isOnlyOneSelection =
      !!range || context.selectionRanges.codeBasedSelections.length === 1

    setEnabled(canReplace && isOnlyOneSelection)
  }, [context.selectionRanges])

  const handleClick = async (valueName?: string) => {
    try {
      const { variableName } = await getModalInfo({
        valueName: valueName || 'var',
      })

      const { modifiedAst: _modifiedAst } = moveValueIntoNewVariable(
        ast,
        kclManager.programMemory,
        range || context.selectionRanges.codeBasedSelections[0].range,
        variableName
      )

      kclManager.updateAst(_modifiedAst, true)
    } catch (e) {
      console.log('error', e)
    }
  }

  editorManager.convertToVariableCallback = handleClick

  return { enable, handleClick }
}
