import { toolTips } from 'lang/langHelpers'
import { Selections } from 'lib/selections'
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
  TransformInfo,
} from '../../lang/std/sketchcombos'
import { GetInfoModal, createInfoModal } from '../SetHorVertDistanceModal'
import { createVariableDeclaration } from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'

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
  if (err(previousSegment)) return previousSegment

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
  const _nodes = paths.map((pathToNode) => {
    const tmp = getNodeFromPath<Value>(kclManager.ast, pathToNode)
    if (err(tmp)) return tmp
    return tmp.node
  })
  const _err1 = _nodes.find(err)
  if (err(_err1)) return _err1
  const nodes = _nodes as Value[]

  const _varDecs = paths.map((pathToNode) => {
    const tmp = getNodeFromPath<VariableDeclarator>(
      kclManager.ast,
      pathToNode,
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
  const info = intersectInfo({
    selectionRanges,
  })
  if (err(info)) return Promise.reject(info)
  const { transforms, forcedSelectionRanges } = info

  const transform1 = transformSecondarySketchLinesTagFirst({
    ast: structuredClone(kclManager.ast),
    selectionRanges: forcedSelectionRanges,
    transformInfos: transforms,
    programMemory: kclManager.programMemory,
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
    }
  }
  // transform again but forcing certain values
  const finalValue = removeDoubleNegatives(
    valueNode as BinaryPart,
    sign,
    variableName
  )
  const transform2 = transformSecondarySketchLinesTagFirst({
    ast: kclManager.ast,
    selectionRanges: forcedSelectionRanges,
    transformInfos: transforms,
    programMemory: kclManager.programMemory,
    forceSegName: segName,
    forceValueUsedInTransform: finalValue,
  })
  if (err(transform2)) return Promise.reject(transform2)
  const { modifiedAst: _modifiedAst, pathToNodeMap: _pathToNodeMap } =
    transform2

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
