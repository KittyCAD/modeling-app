import { SetVarNameModal } from 'components/SetVarNameModal'
import { moveValueIntoNewVariable } from 'lang/modifyAst'
import { isNodeSafeToReplace } from 'lang/queryAst'
import { useEffect, useState } from 'react'
import { create } from 'react-modal-promise'
import { useStore } from 'useStore'

const getModalInfo = create(SetVarNameModal as any)

export function useConvertToVariable() {
  const { guiMode, selectionRanges, ast, programMemory, updateAst } = useStore(
    (s) => ({
      guiMode: s.guiMode,
      ast: s.ast,
      updateAst: s.updateAst,
      selectionRanges: s.selectionRanges,
      programMemory: s.programMemory,
    })
  )
  const [enable, setEnabled] = useState(false)
  useEffect(() => {
    if (!ast) return

    const { isSafe, value } = isNodeSafeToReplace(
      ast,
      selectionRanges.codeBasedSelections?.[0]?.range || []
    )
    const canReplace = isSafe && value.type !== 'Identifier'
    const isOnlyOneSelection = selectionRanges.codeBasedSelections.length === 1

    const _enableHorz = canReplace && isOnlyOneSelection
    setEnabled(_enableHorz)
  }, [guiMode, selectionRanges])

  const handleClick = async () => {
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

      updateAst(_modifiedAst, false)
    } catch (e) {
      console.log('e', e)
    }
  }

  return { enable, handleClick }
}
