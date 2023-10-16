import { toolTips } from '../../useStore'
import { Selections } from 'lib/selections'
import { BinaryPart, Program, Value } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import {
  getTransformInfos,
  transformAstSketchLines,
  PathToNodeMap,
} from '../../lang/std/sketchcombos'
import {
  SetAngleLengthModal,
  createSetAngleLengthModal,
} from '../SetAngleLengthModal'
import {
  createIdentifier,
  createVariableDeclaration,
} from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { kclManager } from 'lang/KclSinglton'

const getModalInfo = createSetAngleLengthModal(SetAngleLengthModal)

type Constraint = 'xAbs' | 'yAbs' | 'snapToYAxis' | 'snapToXAxis'

export function absDistanceInfo({
  selectionRanges,
  constraint,
}: {
  selectionRanges: Selections
  constraint: Constraint
}) {
  const disType =
    constraint === 'xAbs' || constraint === 'yAbs'
      ? constraint
      : constraint === 'snapToYAxis'
      ? 'xAbs'
      : 'yAbs'
  const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
    getNodePathFromSourceRange(kclManager.ast, range)
  )
  const nodes = paths.map(
    (pathToNode) =>
      getNodeFromPath<Value>(kclManager.ast, pathToNode, 'CallExpression').node
  )
  const isAllTooltips = nodes.every(
    (node) =>
      node?.type === 'CallExpression' &&
      toolTips.includes(node.callee.name as any)
  )

  const transforms = getTransformInfos(selectionRanges, kclManager.ast, disType)

  const enableY =
    disType === 'yAbs' &&
    selectionRanges.otherSelections.length === 1 &&
    selectionRanges.otherSelections[0] === 'x-axis' // select the x axis to set the distance from it i.e. y
  const enableX =
    disType === 'xAbs' &&
    selectionRanges.otherSelections.length === 1 &&
    selectionRanges.otherSelections[0] === 'y-axis' // select the y axis to set the distance from it i.e. x

  const enabled =
    isAllTooltips &&
    transforms.every(Boolean) &&
    selectionRanges.codeBasedSelections.length === 1 &&
    (enableX || enableY)

  return { enabled, transforms }
}

export async function applyConstraintAbsDistance({
  selectionRanges,
  constraint,
}: {
  selectionRanges: Selections
  constraint: 'xAbs' | 'yAbs'
}): Promise<{
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
}> {
  const transformInfos = absDistanceInfo({
    selectionRanges,
    constraint,
  }).transforms
  const { valueUsedInTransform } = transformAstSketchLines({
    ast: JSON.parse(JSON.stringify(kclManager.ast)),
    selectionRanges: selectionRanges,
    transformInfos,
    programMemory: kclManager.programMemory,
    referenceSegName: '',
  })
  let forceVal = valueUsedInTransform || 0
  const { valueNode, variableName, newVariableInsertIndex, sign } =
    await getModalInfo({
      value: forceVal,
      valueName: constraint === 'yAbs' ? 'yDis' : 'xDis',
    })
  let finalValue = removeDoubleNegatives(
    valueNode as BinaryPart,
    sign,
    variableName
  )

  const { modifiedAst: _modifiedAst, pathToNodeMap } = transformAstSketchLines({
    ast: JSON.parse(JSON.stringify(kclManager.ast)),
    selectionRanges: selectionRanges,
    transformInfos,
    programMemory: kclManager.programMemory,
    referenceSegName: '',
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
  return { modifiedAst: _modifiedAst, pathToNodeMap }
}

export function applyConstraintAxisAlign({
  selectionRanges,
  constraint,
}: {
  selectionRanges: Selections
  constraint: 'snapToYAxis' | 'snapToXAxis'
}): {
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
} {
  const transformInfos = absDistanceInfo({
    selectionRanges,
    constraint,
  }).transforms

  let finalValue = createIdentifier('_0')

  return transformAstSketchLines({
    ast: JSON.parse(JSON.stringify(kclManager.ast)),
    selectionRanges: selectionRanges,
    transformInfos,
    programMemory: kclManager.programMemory,
    referenceSegName: '',
    forceValueUsedInTransform: finalValue,
  })
}
