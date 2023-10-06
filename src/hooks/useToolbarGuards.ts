import { SetVarNameModal } from 'components/SetVarNameModal'
import { kclManager } from 'lang/KclSinglton'
import { moveValueIntoNewVariable } from 'lang/modifyAst'
import { isNodeSafeToReplace } from 'lang/queryAst'
import { useEffect, useState } from 'react'
import { create } from 'react-modal-promise'
import { useStore } from 'useStore'
import { useModelingContext } from 'hooks/useModelingContext'

const getModalInfo = create(SetVarNameModal as any)

export function useConvertToVariable() {
  const { guiMode, selectionRanges } = useStore((s) => ({
    guiMode: s.guiMode,
    selectionRanges: s.selectionRanges,
  }))
  const [enable, setEnabled] = useState(false)
  const { context } = useModelingContext()
  useEffect(() => {
    const { isSafe, value } = isNodeSafeToReplace(
      kclManager.ast,
      selectionRanges.codeBasedSelections?.[0]?.range || []
    )
    const canReplace = isSafe && value.type !== 'Identifier'
    const isOnlyOneSelection = selectionRanges.codeBasedSelections.length === 1

    const _enableHorz = canReplace && isOnlyOneSelection
    setEnabled(_enableHorz)
  }, [guiMode, selectionRanges])

  const handleClick = async () => {
    try {
      const { variableName } = await getModalInfo({
        valueName: 'var',
      } as any)

      const { modifiedAst: _modifiedAst } = moveValueIntoNewVariable(
        kclManager.ast,
        kclManager.programMemory,
        selectionRanges.codeBasedSelections[0].range,
        variableName
      )

      kclManager.updateAst(context.defaultPlanes.planes, _modifiedAst, true)
    } catch (e) {
      console.log('error', e)
    }
  }

  return { enable, handleClick }
}
