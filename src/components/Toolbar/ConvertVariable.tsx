import { useState, useEffect } from 'react'
import { create } from 'react-modal-promise'
import { useStore } from '../../useStore'
import { isNodeSafeToReplace } from '../../lang/queryAst'
import { SetVarNameModal } from '../SetVarNameModal'
import { moveValueIntoNewVariable } from '../../lang/modifyAst'

const getModalInfo = create(SetVarNameModal as any)

export const ConvertToVariable = () => {
  const { guiMode, selectionRanges, ast, programMemory, updateAst } = useStore(
    (s) => ({
      guiMode: s.guiMode,
      ast: s.ast,
      updateAst: s.updateAst,
      selectionRanges: s.selectionRanges,
      programMemory: s.programMemory,
    })
  )
  const [enableAngLen, setEnableAngLen] = useState(false)
  useEffect(() => {
    if (!ast) return

    const { isSafe, value } = isNodeSafeToReplace(
      ast,
      selectionRanges.codeBasedSelections?.[0]?.range || []
    )
    const canReplace = isSafe && value.type !== 'Identifier'
    const isOnlyOneSelection = selectionRanges.codeBasedSelections.length === 1

    const _enableHorz = canReplace && isOnlyOneSelection
    setEnableAngLen(_enableHorz)
  }, [ast, guiMode, selectionRanges])

  return (
    <button
      onClick={async () => {
        if (!ast) return
        try {
          const { variableName } = await getModalInfo({
            valueName: 'var',
          } as any)

          const { modifiedAst: _modifiedAst } = moveValueIntoNewVariable(
            ast,
            programMemory,
            selectionRanges.codeBasedSelections[0].range,
            variableName
          )

          updateAst(_modifiedAst)
        } catch (e) {
          console.log('e', e)
        }
      }}
      disabled={!enableAngLen}
    >
      ConvertToVariable
    </button>
  )
}
