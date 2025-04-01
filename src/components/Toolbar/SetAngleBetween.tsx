import { removeDoubleNegatives } from '@src/components/AvailableVarsHelpers'
import {
  GetInfoModal,
  createInfoModal,
} from '@src/components/SetHorVertDistanceModal'
import { toolTips } from '@src/lang/langHelpers'
import { createVariableDeclaration } from '@src/lang/modifyAst'
import { getNodeFromPath } from '@src/lang/queryAst'
import { isSketchVariablesLinked } from '@src/lang/std/sketchConstraints'
import type { PathToNodeMap } from '@src/lang/std/sketchcombos'
import {
  getTransformInfos,
  isExprBinaryPart,
  transformSecondarySketchLinesTagFirst,
} from '@src/lang/std/sketchcombos'
import type { TransformInfo } from '@src/lang/std/stdTypes'
import type { Expr, Program, VariableDeclarator } from '@src/lang/wasm'
import type { Selections } from '@src/lib/selections'
import { kclManager } from '@src/lib/singletons'
import { err } from '@src/lib/trap'

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
  const _nodes = selectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<Expr>(kclManager.ast, codeRef.pathToNode)
    if (err(tmp)) return tmp
    return tmp.node
  })
  const _err1 = _nodes.find(err)
  if (err(_err1)) return _err1
  const nodes = _nodes as Expr[]

  const _varDecs = selectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<VariableDeclarator>(
      kclManager.ast,
      codeRef.pathToNode,
      'VariableDeclarator'
    )
    if (err(tmp)) return tmp
    return tmp.node
  })
  const _err2 = _varDecs.find(err)
  if (err(_err2)) return _err2
  const varDecs = _varDecs as VariableDeclarator[]

  const primaryLine = varDecs[0]
  const secondaryVarDecs = varDecs.slice(1)
  const isOthersLinkedToPrimary = secondaryVarDecs.every((secondary) =>
    isSketchVariablesLinked(secondary, primaryLine, kclManager.ast)
  )
  const isAllTooltips = nodes.every(
    (node) =>
      (node?.type === 'CallExpression' || node?.type === 'CallExpressionKw') &&
      toolTips.includes(node.callee.name.name as any)
  )

  const theTransforms = getTransformInfos(
    {
      ...selectionRanges,
      graphSelections: selectionRanges.graphSelections.slice(1),
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
}: {
  selectionRanges: Selections
}): Promise<{
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
  exprInsertIndex: number
}> {
  const info = angleBetweenInfo({ selectionRanges })
  if (err(info)) return Promise.reject(info)
  const transformInfos = info.transforms

  const transformed1 = transformSecondarySketchLinesTagFirst({
    ast: structuredClone(kclManager.ast),
    selectionRanges,
    transformInfos,
    memVars: kclManager.variables,
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
      exprInsertIndex: -1,
    }
  }

  if (!isExprBinaryPart(valueNode))
    return Promise.reject('Invalid valueNode, is not a BinaryPart')
  const finalValue = removeDoubleNegatives(valueNode, sign, variableName)
  // transform again but forcing certain values
  const transformed2 = transformSecondarySketchLinesTagFirst({
    ast: kclManager.ast,
    selectionRanges,
    transformInfos,
    memVars: kclManager.variables,
    forceSegName: segName,
    forceValueUsedInTransform: finalValue,
  })
  if (err(transformed2)) return Promise.reject(transformed2)
  const { modifiedAst: _modifiedAst, pathToNodeMap: _pathToNodeMap } =
    transformed2

  let exprInsertIndex = -1
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
    exprInsertIndex = newVariableInsertIndex
  }
  return {
    modifiedAst: _modifiedAst,
    pathToNodeMap: _pathToNodeMap,
    exprInsertIndex,
  }
}
