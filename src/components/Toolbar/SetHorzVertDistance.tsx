import { useState, useEffect } from 'react'
import { create } from 'react-modal-promise'
import { toolTips, useStore } from '../../useStore'
import {
  BinaryPart,
  Value,
  VariableDeclarator,
} from '../../lang/abstractSyntaxTree'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  TransformInfo,
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
} from '../../lang/std/sketchcombos'
import { GetInfoModal } from '../SetHorVertDistanceModal'
import {
  createIdentifier,
  createVariableDeclaration,
} from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'

const getModalInfo = create(GetInfoModal as any)

export const SetHorzVertDistance = ({
  horOrVert,
}: {
  horOrVert: 'setHorzDistance' | 'setVertDistance'
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
  const [enable, setEnable] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  useEffect(() => {
    if (!ast) return
    const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
      getNodePathFromSourceRange(ast, range)
    )
    const nodes = paths.map(
      (pathToNode) => getNodeFromPath<Value>(ast, pathToNode).node
    )
    const varDecs = paths.map(
      (pathToNode) =>
        getNodeFromPath<VariableDeclarator>(
          ast,
          pathToNode,
          'VariableDeclarator'
        )?.node
    )
    const primaryLine = varDecs[0]
    const secondaryVarDecs = varDecs.slice(1)
    const isOthersLinkedToPrimary = secondaryVarDecs.every((secondary) =>
      isSketchVariablesLinked(secondary, primaryLine, ast)
    )
    const isAllTooltips = nodes.every(
      (node) =>
        node?.type === 'CallExpression' &&
        [
          ...toolTips,
          'startSketchAt', // TODO probably a better place for this to live
        ].includes(node.callee.name as any)
    )

    const theTransforms = getTransformInfos(
      {
        ...selectionRanges,
        codeBasedSelections: selectionRanges.codeBasedSelections.slice(1),
      },
      ast,
      horOrVert
    )
    setTransformInfos(theTransforms)

    const _enableEqual =
      secondaryVarDecs.length === 1 &&
      isAllTooltips &&
      isOthersLinkedToPrimary &&
      theTransforms.every(Boolean)
    setEnable(_enableEqual)
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  return (
    <button
      onClick={async () => {
        if (transformInfos && ast) {
          const { modifiedAst, tagInfo, valueUsedInTransform } =
            transformSecondarySketchLinesTagFirst({
              ast: JSON.parse(JSON.stringify(ast)),
              selectionRanges,
              transformInfos,
              programMemory,
            })
          const {
            segName,
            value,
            valueNode,
            variableName,
            newVariableInsertIndex,
            sign,
          }: {
            segName: string
            value: number
            valueNode: Value
            variableName?: string
            newVariableInsertIndex: number
            sign: number
          } = await getModalInfo({
            segName: tagInfo?.tag,
            isSegNameEditable: !tagInfo?.isTagExisting,
            value: valueUsedInTransform,
            initialVariableName:
              horOrVert === 'setHorzDistance' ? 'xDis' : 'yDis',
          } as any)
          if (segName === tagInfo?.tag && value === valueUsedInTransform) {
            updateAst(modifiedAst)
          } else {
            const finalValue = removeDoubleNegatives(
              valueNode as BinaryPart,
              sign,
              variableName
            )
            // transform again but forcing certain values
            const { modifiedAst: _modifiedAst } =
              transformSecondarySketchLinesTagFirst({
                ast,
                selectionRanges,
                transformInfos,
                programMemory,
                forceSegName: segName,
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
          }
        }
      }}
      className={`border m-1 px-1 rounded text-xs ${
        enable ? 'bg-gray-50 text-gray-800' : 'bg-gray-200 text-gray-400'
      }`}
      disabled={!enable}
    >
      {horOrVert}
    </button>
  )
}
