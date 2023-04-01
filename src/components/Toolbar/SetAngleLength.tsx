import { useState, useEffect } from 'react'
import { create } from 'react-modal-promise'
import { toolTips, useStore } from '../../useStore'
import { Value } from '../../lang/abstractSyntaxTree'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
  findAllPreviousVariables,
} from '../../lang/queryAst'
import {
  TransformInfo,
  getTransformInfos,
  transformAstSketchLines,
} from '../../lang/std/sketchcombos'
import { SetAngleLengthModal } from '../SetAngleLengthModal'
import {
  createIdentifier,
  createVariableDeclaration,
} from '../../lang/modifyAst'

const getModalInfo = create(SetAngleLengthModal as any)

export const SetAngleLength = ({
  angleOrLength,
}: {
  angleOrLength: 'setAngle' | 'setLength'
}) => {
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
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  useEffect(() => {
    if (!ast) return
    const paths = selectionRanges.map((selectionRange) =>
      getNodePathFromSourceRange(ast, selectionRange)
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
        const { modifiedAst, valueUsedInTransform } = transformAstSketchLines({
          ast: JSON.parse(JSON.stringify(ast)),
          selectionRanges,
          transformInfos,
          programMemory,
          referenceSegName: '',
        })
        try {
          const { valueNode, variableName, newVariableInsertIndex } =
            await getModalInfo({
              value: valueUsedInTransform,
              valueName: angleOrLength === 'setAngle' ? 'angle' : 'length',
            } as any)

          const { modifiedAst: _modifiedAst } = transformAstSketchLines({
            ast: JSON.parse(JSON.stringify(ast)),
            selectionRanges,
            transformInfos,
            programMemory,
            referenceSegName: '',
            forceValueUsedInTransform: variableName
              ? createIdentifier(variableName)
              : valueNode,
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
      {angleOrLength}
    </button>
  )
}
