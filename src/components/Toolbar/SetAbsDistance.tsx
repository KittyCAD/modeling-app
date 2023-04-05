import { useState, useEffect } from 'react'
import { create } from 'react-modal-promise'
import { toolTips, useStore } from '../../useStore'
import { Value } from '../../lang/abstractSyntaxTree'
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
import { createVariableDeclaration } from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'

const getModalInfo = create(SetAngleLengthModal as any)

export const SetAbsDistance = ({ disType }: { disType: 'xAbs' | 'yAbs' }) => {
  const {
    guiMode,
    selectionRanges: selections,
    ast,
    programMemory,
    updateAst,
  } = useStore((s) => ({
    guiMode: s.guiMode,
    ast: s.ast,
    updateAst: s.updateAst,
    selectionRanges: s.selectionRanges,
    programMemory: s.programMemory,
  }))
  const [enableAngLen, setEnableAngLen] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  useEffect(() => {
    if (!ast) return
    const paths = selections.codeBasedSelections.map(({ range }) =>
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

    const theTransforms = getTransformInfos(selections, ast, disType)
    setTransformInfos(theTransforms)

    const enableY =
      disType === 'yAbs' &&
      selections.otherSelections.length === 1 &&
      selections.otherSelections[0] === 'x-axis' // select the x axis to set the distance from it i.e. y
    const enableX =
      disType === 'xAbs' &&
      selections.otherSelections.length === 1 &&
      selections.otherSelections[0] === 'y-axis' // select the y axis to set the distance from it i.e. x

    const _enableHorz =
      isAllTooltips &&
      theTransforms.every(Boolean) &&
      selections.codeBasedSelections.length === 1 &&
      (enableX || enableY)
    setEnableAngLen(_enableHorz)
  }, [guiMode, selections])
  if (guiMode.mode !== 'sketch') return null

  return (
    <button
      onClick={async () => {
        if (!(transformInfos && ast)) return
        const { valueUsedInTransform } = transformAstSketchLines({
          ast: JSON.parse(JSON.stringify(ast)),
          selectionRanges: selections,
          transformInfos,
          programMemory,
          referenceSegName: '',
        })
        try {
          let forceVal = valueUsedInTransform || 0
          const { valueNode, variableName, newVariableInsertIndex, sign } =
            await getModalInfo({
              value: forceVal,
              valueName: disType === 'yAbs' ? 'yDis' : 'xDis',
            } as any)
          let finalValue = removeDoubleNegatives(valueNode, sign, variableName)

          const { modifiedAst: _modifiedAst } = transformAstSketchLines({
            ast: JSON.parse(JSON.stringify(ast)),
            selectionRanges: selections,
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

          updateAst(_modifiedAst)
        } catch (e) {
          console.log('e', e)
        }
      }}
      className={`border m-1 px-1 rounded text-xs ${
        enableAngLen ? 'bg-gray-50 text-gray-800' : 'bg-gray-200 text-gray-400'
      }`}
      disabled={!enableAngLen}
    >
      {disType}
    </button>
  )
}
