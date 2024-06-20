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
  TransformInfo,
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
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'

const getModalInfo = createSetAngleLengthModal(SetAngleLengthModal)

type Constraint = 'xAbs' | 'yAbs' | 'snapToYAxis' | 'snapToXAxis'

export function absDistanceInfo({
  selectionRanges,
  constraint,
}: {
  selectionRanges: Selections
  constraint: Constraint
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
    }
  | Error {
  const disType =
    constraint === 'xAbs' || constraint === 'yAbs'
      ? constraint
      : constraint === 'snapToYAxis'
      ? 'xAbs'
      : 'yAbs'
  const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
    getNodePathFromSourceRange(kclManager.ast, range)
  )
  const _nodes = paths.map((pathToNode) => {
    const tmp = getNodeFromPath<Value>(
      kclManager.ast,
      pathToNode,
      'CallExpression'
    )
    if (err(tmp)) return tmp
    return tmp.node
  })
  const _err1 = _nodes.find(err)
  if (err(_err1)) return _err1
  const nodes = _nodes as Value[]

  const isAllTooltips = nodes.every(
    (node) =>
      node?.type === 'CallExpression' &&
      toolTips.includes(node.callee.name as any)
  )

  const transforms = getTransformInfos(selectionRanges, kclManager.ast, disType)
  if (err(transforms)) return transforms

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
  const info = absDistanceInfo({
    selectionRanges,
    constraint,
  })
  if (err(info)) return Promise.reject(info)
  const transformInfos = info.transforms

  const transform1 = transformAstSketchLines({
    ast: JSON.parse(JSON.stringify(kclManager.ast)),
    selectionRanges: selectionRanges,
    transformInfos,
    programMemory: kclManager.programMemory,
    referenceSegName: '',
  })
  if (err(transform1)) return Promise.reject(transform1)
  const { valueUsedInTransform } = transform1

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

  const transform2 = transformAstSketchLines({
    ast: JSON.parse(JSON.stringify(kclManager.ast)),
    selectionRanges: selectionRanges,
    transformInfos,
    programMemory: kclManager.programMemory,
    referenceSegName: '',
    forceValueUsedInTransform: finalValue,
  })
  if (err(transform2)) return Promise.reject(transform2)
  const { modifiedAst: _modifiedAst, pathToNodeMap } = transform2

  if (variableName) {
    const newBody = [..._modifiedAst.body]
    newBody.splice(
      newVariableInsertIndex,
      0,
      createVariableDeclaration(variableName, valueNode)
    )
    _modifiedAst.body = newBody
    Object.values(pathToNodeMap).forEach((pathToNode) => {
      const index = pathToNode.findIndex((a) => a[0] === 'body') + 1
      pathToNode[index][0] = Number(pathToNode[index][0]) + 1
    })
  }
  return { modifiedAst: _modifiedAst, pathToNodeMap }
}

export function applyConstraintAxisAlign({
  selectionRanges,
  constraint,
}: {
  selectionRanges: Selections
  constraint: 'snapToYAxis' | 'snapToXAxis'
}):
  | {
      modifiedAst: Program
      pathToNodeMap: PathToNodeMap
    }
  | Error {
  const info = absDistanceInfo({
    selectionRanges,
    constraint,
  })
  if (err(info)) return info
  const transformInfos = info.transforms

  let finalValue = createIdentifier('ZERO')

  return transformAstSketchLines({
    ast: JSON.parse(JSON.stringify(kclManager.ast)),
    selectionRanges: selectionRanges,
    transformInfos,
    programMemory: kclManager.programMemory,
    referenceSegName: '',
    forceValueUsedInTransform: finalValue,
  })
}
