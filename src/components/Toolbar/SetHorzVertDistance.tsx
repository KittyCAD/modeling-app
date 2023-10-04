import { useState, useEffect } from 'react'
import { create } from 'react-modal-promise'
import { toolTips, useStore } from '../../useStore'
import { BinaryPart, Program, Value, VariableDeclarator } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  TransformInfo,
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
  ConstraintType,
  PathToNodeMap,
} from '../../lang/std/sketchcombos'
import { GetInfoModal } from '../SetHorVertDistanceModal'
import { createLiteral, createVariableDeclaration } from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { updateCursors } from '../../lang/util'
import { kclManager } from 'lang/KclSinglton'
import { Selections } from 'useStore'

const getModalInfo = create(GetInfoModal as any)

type ButtonType =
  | 'setHorzDistance'
  | 'setVertDistance'
  | 'alignEndsHorizontally'
  | 'alignEndsVertically'

const buttonLabels: Record<ButtonType, string> = {
  setHorzDistance: 'Set Horizontal Distance',
  setVertDistance: 'Set Vertical Distance',
  alignEndsHorizontally: 'Align Ends Horizontally',
  alignEndsVertically: 'Align Ends Vertically',
}

export const SetHorzVertDistance = ({
  buttonType,
}: {
  buttonType: ButtonType
}) => {
  const { guiMode, selectionRanges, setCursor } = useStore((s) => ({
    guiMode: s.guiMode,
    selectionRanges: s.selectionRanges,
    setCursor: s.setCursor,
  }))
  const constraint: ConstraintType =
    buttonType === 'setHorzDistance' || buttonType === 'setVertDistance'
      ? buttonType
      : buttonType === 'alignEndsHorizontally'
      ? 'setVertDistance'
      : 'setHorzDistance'
  const [enable, setEnable] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  useEffect(() => {
    const { transforms, enabled } = horzVertDistanceInfo({
      selectionRanges,
      constraint,
    })
    setTransformInfos(transforms)
    setEnable(enabled)
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  const isAlign =
    buttonType === 'alignEndsHorizontally' ||
    buttonType === 'alignEndsVertically'

  return (
    <button
      onClick={async () => {
        if (!transformInfos) return
        const { modifiedAst, tagInfo, valueUsedInTransform, pathToNodeMap } =
          transformSecondarySketchLinesTagFirst({
            ast: JSON.parse(JSON.stringify(kclManager.ast)),
            selectionRanges,
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
        } = await (!isAlign &&
          getModalInfo({
            segName: tagInfo?.tag,
            isSegNameEditable: !tagInfo?.isTagExisting,
            value: valueUsedInTransform,
            initialVariableName:
              constraint === 'setHorzDistance' ? 'xDis' : 'yDis',
          } as any))
        if (segName === tagInfo?.tag && value === valueUsedInTransform) {
          kclManager.updateAst(modifiedAst, true, {
            callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
          })
        } else {
          let finalValue = isAlign
            ? createLiteral(0)
            : removeDoubleNegatives(valueNode as BinaryPart, sign, variableName)
          // transform again but forcing certain values
          const { modifiedAst: _modifiedAst, pathToNodeMap } =
            transformSecondarySketchLinesTagFirst({
              ast: kclManager.ast,
              selectionRanges,
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
      title={buttonLabels[buttonType]}
    >
      {buttonLabels[buttonType]}
    </button>
  )
}

export function horzVertDistanceInfo({
  selectionRanges,
  constraint,
}: {
  selectionRanges: Selections
  constraint: 'setHorzDistance' | 'setVertDistance'
}) {
  const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
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
      codeBasedSelections: selectionRanges.codeBasedSelections.slice(1),
    },
    kclManager.ast,
    constraint
  )
  const _enableEqual =
    secondaryVarDecs.length === 1 &&
    isAllTooltips &&
    isOthersLinkedToPrimary &&
    theTransforms.every(Boolean)
  return { enabled: _enableEqual, transforms: theTransforms }
}

export async function applyConstraintHorzVertDistance({
  selectionRanges,
  constraint,
  isAlign = false,
}: {
  selectionRanges: Selections
  constraint: 'setHorzDistance' | 'setVertDistance'
  isAlign?: boolean
}): Promise<{
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
}> {
  const transformInfos = horzVertDistanceInfo({
    selectionRanges,
    constraint,
  }).transforms
  const { modifiedAst, tagInfo, valueUsedInTransform, pathToNodeMap } =
    transformSecondarySketchLinesTagFirst({
      ast: JSON.parse(JSON.stringify(kclManager.ast)),
      selectionRanges,
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
  } = await (!isAlign &&
    getModalInfo({
      segName: tagInfo?.tag,
      isSegNameEditable: !tagInfo?.isTagExisting,
      value: valueUsedInTransform,
      initialVariableName: constraint === 'setHorzDistance' ? 'xDis' : 'yDis',
    } as any))
  if (segName === tagInfo?.tag && value === valueUsedInTransform) {
    return {
      modifiedAst,
      pathToNodeMap,
    }
    // TODO handle cursor stuff
    // kclManager.updateAst(modifiedAst, true, {
    //   callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
    // })
  } else {
    let finalValue = isAlign
      ? createLiteral(0)
      : removeDoubleNegatives(valueNode as BinaryPart, sign, variableName)
    // transform again but forcing certain values
    const { modifiedAst: _modifiedAst, pathToNodeMap } =
      transformSecondarySketchLinesTagFirst({
        ast: kclManager.ast,
        selectionRanges,
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
    return {
      modifiedAst: _modifiedAst,
      pathToNodeMap,
    }
    // TODO handle cursor stuff
    // kclManager.updateAst(_modifiedAst, true, {
    //   callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
    // })
  }
  throw new Error('should not get here')
}
