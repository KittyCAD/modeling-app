import { Selections, toolTips } from '../../useStore'
import { BinaryPart, Program, Value, VariableDeclarator } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
  isLinesParallelAndConstrained,
} from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
  PathToNodeMap,
} from '../../lang/std/sketchcombos'
import { GetInfoModal, createInfoModal } from '../SetHorVertDistanceModal'
import { createVariableDeclaration } from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { kclManager } from 'lang/KclSinglton'

const getModalInfo = createInfoModal(GetInfoModal)

export function intersectInfo({
  selectionRanges,
}: {
  selectionRanges: Selections
}) {
  if (selectionRanges.codeBasedSelections.length < 2) {
    return {
      enabled: false,
      transforms: [],
      forcedSelectionRanges: { ...selectionRanges },
    }
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
      codeBasedSelections: _forcedSelectionRanges.codeBasedSelections.slice(1),
    },
    kclManager.ast,
    'intersect'
  )

  const _enableEqual =
    secondaryVarDecs.length === 1 &&
    isAllTooltips &&
    isOthersLinkedToPrimary &&
    theTransforms.every(Boolean) &&
    _forcedSelectionRanges?.codeBasedSelections?.[1]?.type === 'line-end'

  return {
    enabled: _enableEqual,
    transforms: theTransforms,
    forcedSelectionRanges: _forcedSelectionRanges,
  }
}

export async function applyConstraintIntersect({
  selectionRanges,
}: {
  selectionRanges: Selections
}): Promise<{
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
}> {
  const { transforms, forcedSelectionRanges } = intersectInfo({
    selectionRanges,
  })
  const { modifiedAst, tagInfo, valueUsedInTransform, pathToNodeMap } =
    transformSecondarySketchLinesTagFirst({
      ast: JSON.parse(JSON.stringify(kclManager.ast)),
      selectionRanges: forcedSelectionRanges,
      transformInfos: transforms,
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
    initialVariableName: 'offset',
  })
  if (segName === tagInfo?.tag && Number(value) === valueUsedInTransform) {
    return {
      modifiedAst,
      pathToNodeMap,
    }
  }
  // transform again but forcing certain values
  const finalValue = removeDoubleNegatives(
    valueNode as BinaryPart,
    sign,
    variableName
  )
  const { modifiedAst: _modifiedAst, pathToNodeMap: _pathToNodeMap } =
    transformSecondarySketchLinesTagFirst({
      ast: kclManager.ast,
      selectionRanges: forcedSelectionRanges,
      transformInfos: transforms,
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
    pathToNodeMap: _pathToNodeMap,
  }
}
