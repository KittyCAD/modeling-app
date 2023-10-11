import { SetVarNameModal } from 'components/SetVarNameModal'
import { kclManager } from 'lang/KclSinglton'
import { moveValueIntoNewVariable } from 'lang/modifyAst'
import { isNodeSafeToReplace } from 'lang/queryAst'
import { useEffect, useState } from 'react'
import { create } from 'react-modal-promise'
import { useModelingContext } from './useModelingContext'

const getModalInfo = create(SetVarNameModal as any)

export function useConvertToVariable() {
  const { context } = useModelingContext()
  const [enable, setEnabled] = useState(false)
  useEffect(() => {
    const { isSafe, value } = isNodeSafeToReplace(
      kclManager.ast,
      context.selectionRanges.codeBasedSelections?.[0]?.range || []
    )
    const canReplace = isSafe && value.type !== 'Identifier'
    const isOnlyOneSelection =
      context.selectionRanges.codeBasedSelections.length === 1

    const _enableHorz = canReplace && isOnlyOneSelection
    setEnabled(_enableHorz)
  }, [context.selectionRanges])

  const handleClick = async () => {
    try {
      const { variableName } = await getModalInfo({
        valueName: 'var',
      } as any)

      const { modifiedAst: _modifiedAst } = moveValueIntoNewVariable(
        kclManager.ast,
        kclManager.programMemory,
        context.selectionRanges.codeBasedSelections[0].range,
        variableName
      )

      kclManager.updateAst(_modifiedAst, true)
    } catch (e) {
      console.log('error', e)
    }
  }

  return { enable, handleClick }
}
