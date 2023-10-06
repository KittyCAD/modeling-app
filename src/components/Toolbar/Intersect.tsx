import { useState, useEffect } from 'react'
import { create } from 'react-modal-promise'
import { toolTips, useStore } from '../../useStore'
import { BinaryPart, Value, VariableDeclarator } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
  isLinesParallelAndConstrained,
} from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  TransformInfo,
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
} from '../../lang/std/sketchcombos'
import { GetInfoModal } from '../SetHorVertDistanceModal'
import { createVariableDeclaration } from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { kclManager } from 'lang/KclSinglton'

const getModalInfo = create(GetInfoModal as any)

/*
export const Intersect = () => {
  const { guiMode, selectionRanges, setCursor } = useStore((s) => ({
    guiMode: s.guiMode,
    selectionRanges: s.selectionRanges,
    setCursor: s.setCursor,
  }))
  const [enable, setEnable] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  const [forecdSelectionRanges, setForcedSelectionRanges] =
    useState<typeof selectionRanges>()
  useEffect(() => {
    if (selectionRanges.codeBasedSelections.length < 2) {
      setEnable(false)
      setForcedSelectionRanges({ ...selectionRanges })
      return
    }

    const previousSegment =
      selectionRanges.codeBasedSelections.length > 1 &&
      isLinesParallelAndConstrained(
        kclManager.ast,
        kclManager.programMemory,
        selectionRanges.codeBasedSelections[0],
        selectionRanges.codeBasedSelections[1]
      )
    const shouldUsePreviousSegment =
      selectionRanges.codeBasedSelections?.[1]?.type !== 'line-end' &&
      previousSegment &&
      previousSegment.isParallelAndConstrained

    const _forcedSelectionRanges: typeof selectionRanges = {
      ...selectionRanges,
      codeBasedSelections: [
        selectionRanges.codeBasedSelections?.[0],
        shouldUsePreviousSegment
          ? {
              range: previousSegment.sourceRange,
              type: 'line-end',
            }
          : selectionRanges.codeBasedSelections?.[1],
      ],
    }
    setForcedSelectionRanges(_forcedSelectionRanges)

    const paths = _forcedSelectionRanges.codeBasedSelections.map(({ range }) =>
      getNodePathFromSourceRange(kclManager.ast, range)
    )
    const nodes = paths.map(
      (pathToNode) => getNodeFromPath<Value>(kclManager.ast, pathToNode).node
    )
    const varDecs = paths.map(
      (pathToNode) =>
        getNodeFromPath<VariableDeclarator>(
          kclManager.ast,
          pathToNode,
          'VariableDeclarator'
        )?.node
    )
    const primaryLine = varDecs[0]
    const secondaryVarDecs = varDecs.slice(1)
    const isOthersLinkedToPrimary = secondaryVarDecs.every((secondary) =>
      isSketchVariablesLinked(secondary, primaryLine, kclManager.ast)
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
        codeBasedSelections:
          _forcedSelectionRanges.codeBasedSelections.slice(1),
      },
      kclManager.ast,
      'intersect'
    )
    setTransformInfos(theTransforms)

    const _enableEqual =
      secondaryVarDecs.length === 1 &&
      isAllTooltips &&
      isOthersLinkedToPrimary &&
      theTransforms.every(Boolean) &&
      _forcedSelectionRanges?.codeBasedSelections?.[1]?.type === 'line-end'
    setEnable(_enableEqual)
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  return (
    <button
      onClick={async () => {
        if (!(transformInfos && forecdSelectionRanges)) return
        const { modifiedAst, tagInfo, valueUsedInTransform, pathToNodeMap } =
          transformSecondarySketchLinesTagFirst({
            ast: JSON.parse(JSON.stringify(kclManager.ast)),
            selectionRanges: forecdSelectionRanges,
            transformInfos,
            programMemory: kclManager.programMemory,
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
          initialVariableName: 'offset',
        } as any)
        if (segName === tagInfo?.tag && value === valueUsedInTransform) {
          kclManager.updateAst(modifiedAst, true, {
            callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
          })
        } else {
          // transform again but forcing certain values
          const finalValue = removeDoubleNegatives(
            valueNode as BinaryPart,
            sign,
            variableName
          )
          const { modifiedAst: _modifiedAst, pathToNodeMap } =
            transformSecondarySketchLinesTagFirst({
              ast: kclManager.ast,
              selectionRanges: forecdSelectionRanges,
              transformInfos,
              programMemory: kclManager.programMemory,
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
          kclManager.updateAst(_modifiedAst, true, {
            callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
          })
        }
      }}
      disabled={!enable}
      title="Set Perpendicular Distance"
    >
      Set Perpendicular Distance
    </button>
  )
}
*/
