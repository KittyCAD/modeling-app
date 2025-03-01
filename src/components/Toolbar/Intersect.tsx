import { toolTips } from 'lang/langHelpers'
import { Program, Expr, VariableDeclarator } from '../../lang/wasm'
import { Selections } from 'lib/selections'
import {
  getNodeFromPath,
  isLinesParallelAndConstrained,
} from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
  PathToNodeMap,
  isExprBinaryPart,
} from '../../lang/std/sketchcombos'
import { TransformInfo } from 'lang/std/stdTypes'
import { GetInfoModal, createInfoModal } from '../SetHorVertDistanceModal'
import { createVariableDeclaration } from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import { Node } from '@rust/kcl-lib/bindings/Node'

const getModalInfo = createInfoModal(GetInfoModal)

export function intersectInfo({
  selectionRanges,
}: {
  selectionRanges: Selections
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
      forcedSelectionRanges: Selections
    }
  | Error {
  if (selectionRanges.graphSelections.length < 2) {
    return {
      enabled: false,
      transforms: [],
      forcedSelectionRanges: { ...selectionRanges },
    }
  }

  const previousSegment =
    selectionRanges.graphSelections.length > 1 &&
    isLinesParallelAndConstrained(
      kclManager.ast,
      engineCommandManager.artifactGraph,
      kclManager.variables,
      selectionRanges.graphSelections[0],
      selectionRanges.graphSelections[1]
    )

  if (err(previousSegment)) return previousSegment

  const artifact = selectionRanges.graphSelections[1]?.artifact
  const shouldUsePreviousSegment =
    (!artifact || artifact.type === 'segment') &&
    previousSegment &&
    previousSegment.isParallelAndConstrained

  const _forcedSelectionRanges: typeof selectionRanges = {
    ...selectionRanges,
    graphSelections: [
      selectionRanges.graphSelections?.[0],
      shouldUsePreviousSegment && previousSegment.selection
        ? previousSegment.selection
        : selectionRanges.graphSelections?.[1],
    ],
  }

  const _nodes = _forcedSelectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<Expr>(kclManager.ast, codeRef.pathToNode)
    if (err(tmp)) return tmp
    return tmp.node
  })
  const _err1 = _nodes.find(err)
  if (err(_err1)) return _err1
  const nodes = _nodes as Expr[]

  const _varDecs = _forcedSelectionRanges.graphSelections.map(({ codeRef }) => {
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
      [
        ...toolTips,
      ].includes(node.callee.name as any)
  )

  const theTransforms = getTransformInfos(
    {
      ...selectionRanges,
      graphSelections: _forcedSelectionRanges.graphSelections.slice(1),
    },
    kclManager.ast,
    'intersect'
  )

  const forcedArtifact = _forcedSelectionRanges?.graphSelections?.[1]?.artifact
  const _enableEqual =
    secondaryVarDecs.length === 1 &&
    isAllTooltips &&
    isOthersLinkedToPrimary &&
    theTransforms.every(Boolean) &&
    (!forcedArtifact || forcedArtifact.type === 'segment')

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
  modifiedAst: Node<Program>
  pathToNodeMap: PathToNodeMap
  exprInsertIndex: number
}> {
  const info = intersectInfo({
    selectionRanges,
  })
  if (err(info)) return Promise.reject(info)
  const { transforms, forcedSelectionRanges } = info

  const transform1 = transformSecondarySketchLinesTagFirst({
    ast: structuredClone(kclManager.ast),
    selectionRanges: forcedSelectionRanges,
    transformInfos: transforms,
    memVars: kclManager.variables,
  })
  if (err(transform1)) return Promise.reject(transform1)
  const { modifiedAst, tagInfo, valueUsedInTransform, pathToNodeMap } =
    transform1

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
  if (
    !variableName &&
    segName === tagInfo?.tag &&
    Number(value) === valueUsedInTransform
  ) {
    return {
      modifiedAst,
      pathToNodeMap,
      exprInsertIndex: -1,
    }
  }
  // transform again but forcing certain values
  if (!isExprBinaryPart(valueNode))
    return Promise.reject('Invalid valueNode, is not a BinaryPart')
  const finalValue = removeDoubleNegatives(valueNode, sign, variableName)
  const transform2 = transformSecondarySketchLinesTagFirst({
    ast: kclManager.ast,
    selectionRanges: forcedSelectionRanges,
    transformInfos: transforms,
    memVars: kclManager.variables,
    forceSegName: segName,
    forceValueUsedInTransform: finalValue,
  })
  if (err(transform2)) return Promise.reject(transform2)
  const { modifiedAst: _modifiedAst, pathToNodeMap: _pathToNodeMap } =
    transform2

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
