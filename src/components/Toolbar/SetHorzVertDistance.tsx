import { toolTips } from '../../useStore'
import { BinaryPart, Program, Value, VariableDeclarator } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
  PathToNodeMap,
} from '../../lang/std/sketchcombos'
import { GetInfoModal, createInfoModal } from '../SetHorVertDistanceModal'
import { createLiteral, createVariableDeclaration } from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { kclManager } from 'lang/KclSinglton'
import { Selections } from 'useStore'

const getModalInfo = createInfoModal(GetInfoModal)

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
  // TODO align will always be false (covered by synconous applyConstraintHorzVertAlign), remove it
  isAlign = false,
}: {
  selectionRanges: Selections
  constraint: 'setHorzDistance' | 'setVertDistance'
  isAlign?: false
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
  } = await getModalInfo({
    segName: tagInfo?.tag,
    isSegNameEditable: !tagInfo?.isTagExisting,
    value: valueUsedInTransform,
    initialVariableName: constraint === 'setHorzDistance' ? 'xDis' : 'yDis',
  } as any)
  if (segName === tagInfo?.tag && Number(value) === valueUsedInTransform) {
    return {
      modifiedAst,
      pathToNodeMap,
    }
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
  }
}

export function applyConstraintHorzVertAlign({
  selectionRanges,
  constraint,
}: {
  selectionRanges: Selections
  constraint: 'setHorzDistance' | 'setVertDistance'
}): {
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
} {
  const transformInfos = horzVertDistanceInfo({
    selectionRanges,
    constraint,
  }).transforms
  let finalValue = createLiteral(0)
  const { modifiedAst, pathToNodeMap } = transformSecondarySketchLinesTagFirst({
    ast: kclManager.ast,
    selectionRanges,
    transformInfos,
    programMemory: kclManager.programMemory,
    forceValueUsedInTransform: finalValue,
  })
  return {
    modifiedAst: modifiedAst,
    pathToNodeMap,
  }
}
