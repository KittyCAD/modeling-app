import { toolTips } from '../../useStore'
import { Selections } from 'lib/selections'
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
import { createVariableDeclaration } from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { kclManager } from 'lang/KclSinglton'

const getModalInfo = createInfoModal(GetInfoModal)

export function angleBetweenInfo({
  selectionRanges,
}: {
  selectionRanges: Selections
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
      toolTips.includes(node.callee.name as any)
  )

  const theTransforms = getTransformInfos(
    {
      ...selectionRanges,
      codeBasedSelections: selectionRanges.codeBasedSelections.slice(1),
    },
    kclManager.ast,
    'setAngleBetween'
  )

  const _enableEqual =
    secondaryVarDecs.length === 1 &&
    isAllTooltips &&
    isOthersLinkedToPrimary &&
    theTransforms.every(Boolean)
  return { enabled: _enableEqual, transforms: theTransforms }
}

export async function applyConstraintAngleBetween({
  selectionRanges,
}: // constraint,
{
  selectionRanges: Selections
  // constraint: 'setHorzDistance' | 'setVertDistance'
}): Promise<{
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
}> {
  const transformInfos = angleBetweenInfo({ selectionRanges }).transforms
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
    initialVariableName: 'angle',
  } as any)
  if (segName === tagInfo?.tag && Number(value) === valueUsedInTransform) {
    return {
      modifiedAst,
      pathToNodeMap,
    }
  }

  const finalValue = removeDoubleNegatives(
    valueNode as BinaryPart,
    sign,
    variableName
  )
  // transform again but forcing certain values
  const { modifiedAst: _modifiedAst, pathToNodeMap: _pathToNodeMap } =
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
    pathToNodeMap: _pathToNodeMap,
  }
}
