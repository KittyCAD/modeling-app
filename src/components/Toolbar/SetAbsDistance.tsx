import { useState, useEffect } from 'react'
import { create } from 'react-modal-promise'
import { toolTips, useStore } from '../../useStore'
import { Value } from '../../lang/abstractSyntaxTreeTypes'
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

const getModalInfo = create(SetAngleLengthModal as any)

export const SetAbsDistance = ({
  buttonType,
}: {
  buttonType: 'xAbs' | 'yAbs' | 'snapToYAxis' | 'snapToXAxis'
}) => {
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
              ast: JSON.parse(JSON.stringify(ast)),
              selectionRanges: selectionRanges,
              transformInfos,
              programMemory,
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

          updateAst(_modifiedAst, {
            callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
          })
        } catch (e) {
          console.log('e', e)
        }
      }}
      disabled={!enableAngLen}
    >
      {buttonType}
    </button>
  )
}
