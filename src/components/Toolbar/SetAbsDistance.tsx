import { useState, useEffect } from 'react'
import { toolTips, useStore } from '../../useStore'
import { BinaryPart, Identifier, Value } from '../../lang/wasm'
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
import {
  SetAngleLengthModal,
  createSetAngleLengthModal,
} from '../SetAngleLengthModal'
import {
  createIdentifier,
  createVariableDeclaration,
} from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { updateCursors } from '../../lang/util'

const getModalInfo = createSetAngleLengthModal(SetAngleLengthModal)

type ButtonType = 'xAbs' | 'yAbs' | 'snapToYAxis' | 'snapToXAxis'

const buttonLabels: Record<ButtonType, string> = {
  xAbs: 'Set distance from X Axis',
  yAbs: 'Set distance from Y Axis',
  snapToYAxis: 'Snap To Y Axis',
  snapToXAxis: 'Snap To X Axis',
}

export const SetAbsDistance = ({ buttonType }: { buttonType: ButtonType }) => {
  const { guiMode, selectionRanges, ast, programMemory, updateAst, setCursor } =
    useStore((s) => ({
      guiMode: s.guiMode,
      ast: s.ast,
      updateAst: s.updateAst,
      selectionRanges: s.selectionRanges,
      programMemory: s.programMemory,
      setCursor: s.setCursor,
    }))
  const disType: ConstraintType =
    buttonType === 'xAbs' || buttonType === 'yAbs'
      ? buttonType
      : buttonType === 'snapToYAxis'
      ? 'xAbs'
      : 'yAbs'
  const [enableAngLen, setEnableAngLen] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  useEffect(() => {
    if (!ast) return
    const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
      getNodePathFromSourceRange(ast, range)
    )
    const nodes = paths.map(
      (pathToNode) =>
        getNodeFromPath<Value>(ast, pathToNode, 'CallExpression').node
    )
    const isAllTooltips = nodes.every(
      (node) =>
        node?.type === 'CallExpression' &&
        toolTips.includes(node.callee.name as any)
    )

    const theTransforms = getTransformInfos(selectionRanges, ast, disType)
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
        if (!(transformInfos && ast)) return
        const { valueUsedInTransform } = transformAstSketchLines({
          ast: JSON.parse(JSON.stringify(ast)),
          selectionRanges: selectionRanges,
          transformInfos,
          programMemory,
          referenceSegName: '',
        })

        function transformValue(
          fv: Identifier | BinaryPart,
          transformInfos: TransformInfo[]
        ) {
          return transformAstSketchLines({
            ast: JSON.parse(JSON.stringify(ast)),
            selectionRanges: selectionRanges,
            transformInfos,
            programMemory,
            referenceSegName: '',
            forceValueUsedInTransform: fv,
          })
        }

        try {
          if (!isAlign) {
            const forceVal = valueUsedInTransform || 0

            const { valueNode, variableName, newVariableInsertIndex, sign } =
              await getModalInfo({
                value: forceVal,
                valueName: disType === 'yAbs' ? 'yDis' : 'xDis',
              })

            const finalValue = removeDoubleNegatives(
              valueNode as BinaryPart,
              sign,
              variableName
            )
            const { modifiedAst: _modifiedAst, pathToNodeMap: _pathToNodeMap } =
              transformValue(finalValue, transformInfos)

            if (variableName) {
              const newBody = [..._modifiedAst.body]
              newBody.splice(
                newVariableInsertIndex,
                0,
                createVariableDeclaration(variableName, valueNode)
              )
              _modifiedAst.body = newBody
            }

            updateAst(_modifiedAst, true, {
              callBack: updateCursors(
                setCursor,
                selectionRanges,
                _pathToNodeMap
              ),
            })
          } else {
            const { modifiedAst: _modifiedAst, pathToNodeMap: _pathToNodeMap } =
              transformValue(createIdentifier('_0'), transformInfos)
            updateAst(_modifiedAst, true, {
              callBack: updateCursors(
                setCursor,
                selectionRanges,
                _pathToNodeMap
              ),
            })
          }
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
