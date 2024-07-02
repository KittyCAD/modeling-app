import { toolTips } from 'lang/langHelpers'
import { Selections } from 'lib/selections'
import { BinaryPart, Program, Value } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import {
  PathToNodeMap,
  getTransformInfos,
  transformAstSketchLines,
  TransformInfo,
} from '../../lang/std/sketchcombos'
import {
  SetAngleLengthModal,
  createSetAngleLengthModal,
} from '../SetAngleLengthModal'
import {
  createBinaryExpressionWithUnary,
  createIdentifier,
  createVariableDeclaration,
} from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { normaliseAngle } from '../../lib/utils'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'

const getModalInfo = createSetAngleLengthModal(SetAngleLengthModal)

export function angleLengthInfo({
  selectionRanges,
  angleOrLength = 'setLength',
}: {
  selectionRanges: Selections
  angleOrLength?: 'setLength' | 'setAngle'
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
    }
  | Error {
  const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
    getNodePathFromSourceRange(kclManager.ast, range)
  )

  const nodes = paths.map((pathToNode) =>
    getNodeFromPath<Value>(kclManager.ast, pathToNode, 'CallExpression')
  )
  const _err1 = nodes.find(err)
  if (err(_err1)) return _err1

  const isAllTooltips = nodes.every((meta) => {
    if (err(meta)) return false
    return (
      meta.node?.type === 'CallExpression' &&
      toolTips.includes(meta.node.callee.name as any)
    )
  })

  const transforms = getTransformInfos(
    selectionRanges,
    kclManager.ast,
    angleOrLength
  )
  const enabled =
    selectionRanges.codeBasedSelections.length <= 1 &&
    isAllTooltips &&
    transforms.every(Boolean)
  return { enabled, transforms }
}

export async function applyConstraintAngleLength({
  selectionRanges,
  angleOrLength = 'setLength',
}: {
  selectionRanges: Selections
  angleOrLength?: 'setLength' | 'setAngle'
}): Promise<{
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
}> {
  const angleLength = angleLengthInfo({ selectionRanges, angleOrLength })
  if (err(angleLength)) return Promise.reject(angleLength)

  const { transforms } = angleLength
  const sketched = transformAstSketchLines({
    ast: JSON.parse(JSON.stringify(kclManager.ast)),
    selectionRanges,
    transformInfos: transforms,
    programMemory: kclManager.programMemory,
    referenceSegName: '',
  })
  if (err(sketched)) return Promise.reject(sketched)
  const { valueUsedInTransform } = sketched

  const isReferencingYAxis =
    selectionRanges.otherSelections.length === 1 &&
    selectionRanges.otherSelections[0] === 'y-axis'
  const isReferencingYAxisAngle =
    isReferencingYAxis && angleOrLength === 'setAngle'

  const isReferencingXAxis =
    selectionRanges.otherSelections.length === 1 &&
    selectionRanges.otherSelections[0] === 'x-axis'
  const isReferencingXAxisAngle =
    isReferencingXAxis && angleOrLength === 'setAngle'

  let forceVal = valueUsedInTransform || 0
  let calcIdentifier = createIdentifier('ZERO')
  if (isReferencingYAxisAngle) {
    calcIdentifier = createIdentifier(
      forceVal < 0 ? 'THREE_QUARTER_TURN' : 'QUARTER_TURN'
    )
    forceVal = normaliseAngle(forceVal + (forceVal < 0 ? 90 : -90))
  } else if (isReferencingXAxisAngle) {
    calcIdentifier = createIdentifier(
      Math.abs(forceVal) > 90 ? 'HALF_TURN' : 'ZERO'
    )
    forceVal =
      Math.abs(forceVal) > 90 ? normaliseAngle(forceVal - 180) : forceVal
  }
  const { valueNode, variableName, newVariableInsertIndex, sign } =
    await getModalInfo({
      value: forceVal,
      valueName: angleOrLength === 'setAngle' ? 'angle' : 'length',
      shouldCreateVariable: true,
    })

  let finalValue = removeDoubleNegatives(
    valueNode as BinaryPart,
    sign,
    variableName
  )
  if (
    isReferencingYAxisAngle ||
    (isReferencingXAxisAngle && calcIdentifier.name !== 'ZERO')
  ) {
    finalValue = createBinaryExpressionWithUnary([calcIdentifier, finalValue])
  }

  const retval = transformAstSketchLines({
    ast: JSON.parse(JSON.stringify(kclManager.ast)),
    selectionRanges,
    transformInfos: transforms,
    programMemory: kclManager.programMemory,
    referenceSegName: '',
    forceValueUsedInTransform: finalValue,
  })
  if (err(retval)) return Promise.reject(retval)

  const { modifiedAst: _modifiedAst, pathToNodeMap } = retval
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
  return {
    modifiedAst: _modifiedAst,
    pathToNodeMap,
  }
}
