import { toolTips } from 'lang/langHelpers'
import { Selections } from 'lib/selections'
import {
  BinaryPart,
  CallExpression,
  Program,
  VariableDeclarator,
} from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getLastNodeFromPath,
  DynamicNode,
  expectNodeOnPath,
  castDynamicNode,
} from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
  PathToNodeMap,
  TransformInfo,
} from '../../lang/std/sketchcombos'
import { GetInfoModal, createInfoModal } from '../SetHorVertDistanceModal'
import { createVariableDeclaration } from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import { isArray } from 'lib/utils'

const getModalInfo = createInfoModal(GetInfoModal)

export function angleBetweenInfo({
  selectionRanges,
}: {
  selectionRanges: Selections
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
    }
  | Error {
  const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
    getNodePathFromSourceRange(kclManager.ast, range)
  )

  const _nodes = paths.map((pathToNode) => {
    const tmp = getLastNodeFromPath(kclManager.ast, pathToNode)
    if (err(tmp)) return tmp
    if (isArray(tmp.node)) {
      return new Error('Expected value node, but found array')
    }
    return tmp.node
  })
  const nodes: DynamicNode[] = []
  for (const node of _nodes) {
    if (err(node)) return node
    nodes.push(node)
  }

  const _varDecs = paths.map((pathToNode) => {
    const varDec = expectNodeOnPath<VariableDeclarator>(
      kclManager.ast,
      pathToNode,
      'VariableDeclarator'
    )
    if (err(varDec)) return varDec
    return varDec
  })
  const varDecs: VariableDeclarator[] = []
  for (const varDec of _varDecs) {
    if (err(varDec)) return varDec
    varDecs.push(varDec)
  }

  const primaryLine = varDecs[0]
  const secondaryVarDecs = varDecs.slice(1)
  const isOthersLinkedToPrimary = secondaryVarDecs.every((secondary) =>
    isSketchVariablesLinked(secondary, primaryLine, kclManager.ast)
  )
  const isAllTooltips = nodes.every(
    (node) =>
      castDynamicNode<CallExpression>(node, 'CallExpression') &&
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
    selectionRanges.otherSelections.length === 0 &&
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
  const info = angleBetweenInfo({ selectionRanges })
  if (err(info)) return Promise.reject(info)
  const transformInfos = info.transforms

  const transformed1 = transformSecondarySketchLinesTagFirst({
    ast: structuredClone(kclManager.ast),
    selectionRanges,
    transformInfos,
    programMemory: kclManager.programMemory,
  })
  if (err(transformed1)) return Promise.reject(transformed1)
  const { modifiedAst, tagInfo, valueUsedInTransform, pathToNodeMap } =
    transformed1

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
  if (
    segName === tagInfo?.tag &&
    Number(value) === valueUsedInTransform &&
    !variableName
  ) {
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
  const transformed2 = transformSecondarySketchLinesTagFirst({
    ast: kclManager.ast,
    selectionRanges,
    transformInfos,
    programMemory: kclManager.programMemory,
    forceSegName: segName,
    forceValueUsedInTransform: finalValue,
  })
  if (err(transformed2)) return Promise.reject(transformed2)
  const { modifiedAst: _modifiedAst, pathToNodeMap: _pathToNodeMap } =
    transformed2

  if (variableName) {
    const newBody = [..._modifiedAst.body]
    newBody.splice(
      newVariableInsertIndex,
      0,
      createVariableDeclaration(variableName, valueNode)
    )
    _modifiedAst.body = newBody
    Object.values(_pathToNodeMap).forEach((pathToNode) => {
      const index = pathToNode.findIndex((a) => a[0] === 'body') + 1
      pathToNode[index][0] = Number(pathToNode[index][0]) + 1
    })
  }
  return {
    modifiedAst: _modifiedAst,
    pathToNodeMap: _pathToNodeMap,
  }
}
