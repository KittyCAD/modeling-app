import { useState, useEffect } from 'react'
import { create } from 'react-modal-promise'
import { toolTips, useStore } from '../../useStore'
import { Value } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import {
  TransformInfo,
  getTransformInfos,
  transformAstSketchLines,
  ConstraintType,
} from '../../lang/std/sketchcombos'
import { SetAngleLengthModal } from '../SetAngleLengthModal'
import {
  createIdentifier,
  createVariableDeclaration,
} from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { updateCursors } from '../../lang/util'
import { kclManager } from 'lang/KclSinglton'
import { useModelingContext } from 'hooks/useModelingContext'

const getModalInfo = create(SetAngleLengthModal as any)

type ButtonType = 'xAbs' | 'yAbs' | 'snapToYAxis' | 'snapToXAxis'

const buttonLabels: Record<ButtonType, string> = {
  xAbs: 'Set distance from X Axis',
  yAbs: 'Set distance from Y Axis',
  snapToYAxis: 'Snap To Y Axis',
  snapToXAxis: 'Snap To X Axis',
}

export const SetAbsDistance = ({ buttonType }: { buttonType: ButtonType }) => {
  const { guiMode, selectionRanges, setCursor } = useStore((s) => ({
    guiMode: s.guiMode,
    selectionRanges: s.selectionRanges,
    setCursor: s.setCursor,
  }))
  const { context } = useModelingContext()
  const disType: ConstraintType =
    buttonType === 'xAbs' || buttonType === 'yAbs'
      ? buttonType
      : buttonType === 'snapToYAxis'
      ? 'xAbs'
      : 'yAbs'
  const [enableAngLen, setEnableAngLen] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  useEffect(() => {
    const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
      getNodePathFromSourceRange(kclManager.ast, range)
    )
    const nodes = paths.map(
      (pathToNode) =>
        getNodeFromPath<Value>(kclManager.ast, pathToNode, 'CallExpression')
          .node
    )
    const isAllTooltips = nodes.every(
      (node) =>
        node?.type === 'CallExpression' &&
        toolTips.includes(node.callee.name as any)
    )

    const theTransforms = getTransformInfos(
      selectionRanges,
      kclManager.ast,
      disType
    )
    setTransformInfos(theTransforms)

    const enableY =
      disType === 'yAbs' &&
      selectionRanges.otherSelections.length === 1 &&
      selectionRanges.otherSelections[0] === 'x-axis' // select the x axis to set the distance from it i.e. y
    const enableX =
      disType === 'xAbs' &&
      selectionRanges.otherSelections.length === 1 &&
      selectionRanges.otherSelections[0] === 'y-axis' // select the y axis to set the distance from it i.e. x

    const _enableHorz =
      isAllTooltips &&
      theTransforms.every(Boolean) &&
      selectionRanges.codeBasedSelections.length === 1 &&
      (enableX || enableY)
    setEnableAngLen(_enableHorz)
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  const isAlign = buttonType === 'snapToYAxis' || buttonType === 'snapToXAxis'

  return (
    <button
      onClick={async () => {
        if (!transformInfos) return
        const { valueUsedInTransform } = transformAstSketchLines({
          ast: JSON.parse(JSON.stringify(kclManager.ast)),
          selectionRanges: selectionRanges,
          transformInfos,
          programMemory: kclManager.programMemory,
          referenceSegName: '',
        })
        try {
          let forceVal = valueUsedInTransform || 0
          const { valueNode, variableName, newVariableInsertIndex, sign } =
            await (!isAlign &&
              getModalInfo({
                value: forceVal,
                valueName: disType === 'yAbs' ? 'yDis' : 'xDis',
              } as any))
          let finalValue = isAlign
            ? createIdentifier('_0')
            : removeDoubleNegatives(valueNode, sign, variableName)

          const { modifiedAst: _modifiedAst, pathToNodeMap } =
            transformAstSketchLines({
              ast: JSON.parse(JSON.stringify(kclManager.ast)),
              selectionRanges: selectionRanges,
              transformInfos,
              programMemory: kclManager.programMemory,
              referenceSegName: '',
              forceValueUsedInTransform: finalValue,
            })
          if (variableName) {
            const newBody = [..._modifiedAst.body]
            newBody.splice(
              newVariableInsertIndex,
              0,
              createVariableDeclaration(variableName, valueNode)
            )
            _modifiedAst.body = newBody
          }

          kclManager.updateAst(
            context.defaultPlanes.planes,
            _modifiedAst,
            true,
            {
              callBack: updateCursors(
                setCursor,
                selectionRanges,
                pathToNodeMap
              ),
            }
          )
        } catch (e) {
          console.log('error', e)
        }
      }}
      disabled={!enableAngLen}
      title={buttonLabels[buttonType]}
    >
      {buttonLabels[buttonType]}
    </button>
  )
}
