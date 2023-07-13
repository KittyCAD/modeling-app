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
} from '../../lang/std/sketchcombos'
import { SetAngleLengthModal } from '../SetAngleLengthModal'
import {
  createBinaryExpressionWithUnary,
  createIdentifier,
  createVariableDeclaration,
} from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { normaliseAngle } from '../../lib/utils'
import { updateCursors } from '../../lang/util'

const getModalInfo = create(SetAngleLengthModal as any)

export const SetAngleLength = ({
  angleOrLength,
}: {
  angleOrLength: 'setAngle' | 'setLength'
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

    const theTransforms = getTransformInfos(selectionRanges, ast, angleOrLength)
    setTransformInfos(theTransforms)

    const _enableHorz = isAllTooltips && theTransforms.every(Boolean)
    setEnableAngLen(_enableHorz)
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  return (
    <button
      onClick={async () => {
        if (!(transformInfos && ast)) return
        const { valueUsedInTransform } = transformAstSketchLines({
          ast: JSON.parse(JSON.stringify(ast)),
          selectionRanges,
          transformInfos,
          programMemory,
          referenceSegName: '',
        })
        try {
          const isReferencingYAxis =
            selectionRanges.otherSelections.length === 1 &&
            selectionRanges.otherSelections[0] === 'y-axis'
          const isReferencingYAxisAngle =
            isReferencingYAxis && angleOrLength === 'setAngle'

          const isReferencingXAxis =
            selectionRanges.otherSelections.length === 1 &&
            selectionRanges.otherSelections[0] === 'x-axis'
          const isReferencingXAxisAngle =
            isReferencingXAxis && angleOrLength === 'setAngle'

          let forceVal = valueUsedInTransform || 0
          let calcIdentifier = createIdentifier('_0')
          if (isReferencingYAxisAngle) {
            calcIdentifier = createIdentifier(forceVal < 0 ? '_270' : '_90')
            forceVal = normaliseAngle(forceVal + (forceVal < 0 ? 90 : -90))
          } else if (isReferencingXAxisAngle) {
            calcIdentifier = createIdentifier(
              Math.abs(forceVal) > 90 ? '_180' : '_0'
            )
            forceVal =
              Math.abs(forceVal) > 90
                ? normaliseAngle(forceVal - 180)
                : forceVal
          }
          const { valueNode, variableName, newVariableInsertIndex, sign } =
            await getModalInfo({
              value: forceVal,
              valueName: angleOrLength === 'setAngle' ? 'angle' : 'length',
              shouldCreateVariable: true,
            } as any)
          let finalValue = removeDoubleNegatives(valueNode, sign, variableName)
          if (
            isReferencingYAxisAngle ||
            (isReferencingXAxisAngle && calcIdentifier.name !== '_0')
          ) {
            finalValue = createBinaryExpressionWithUnary([
              calcIdentifier,
              finalValue,
            ])
          }

          const { modifiedAst: _modifiedAst, pathToNodeMap } =
            transformAstSketchLines({
              ast: JSON.parse(JSON.stringify(ast)),
              selectionRanges,
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
      className={`border m-1 px-1 rounded text-xs ${
        enableAngLen ? 'bg-gray-50 text-gray-800' : 'bg-gray-200 text-gray-400'
      }`}
      disabled={!enableAngLen}
    >
      {angleOrLength}
    </button>
  )
}
