import { removeDoubleNegatives } from '@src/components/AvailableVarsHelpers'
import {
  SetAngleLengthModal,
  createSetAngleLengthModal,
} from '@src/components/SetAngleLengthModal'
import {
  createBinaryExpressionWithUnary,
  createLocalName,
  createName,
  createVariableDeclaration,
} from '@src/lang/create'
import type { PathToNodeMap } from '@src/lang/std/sketchcombos'
import {
  isExprBinaryPart,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'
import type { Expr, Program } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { Selections } from '@src/lib/selections'
import { kclManager } from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import { normaliseAngle } from '@src/lib/utils'
import { angleLengthInfo } from './angleLengthInfo'

const getModalInfo = createSetAngleLengthModal(SetAngleLengthModal)

export async function applyConstraintLength({
  length,
  selectionRanges,
}: {
  length: KclCommandValue
  selectionRanges: Selections
}): Promise<{
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
  exprInsertIndex: number
}> {
  const ast = kclManager.ast
  const angleLength = angleLengthInfo({ selectionRanges })
  if (err(angleLength)) return Promise.reject(angleLength)
  const { transforms } = angleLength

  let distanceExpression: Expr = length.valueAst

  /**
   * To be "constrained", the value must be a binary expression, a named value, or a function call.
   * If it has a variable name, we need to insert a variable declaration at the correct index.
   */
  if (
    'variableName' in length &&
    length.variableName &&
    length.insertIndex !== undefined
  ) {
    const newBody = [...ast.body]
    newBody.splice(length.insertIndex, 0, length.variableDeclarationAst)
    ast.body = newBody
    distanceExpression = createLocalName(length.variableName)
  }

  if (!isExprBinaryPart(distanceExpression)) {
    return Promise.reject('Invalid valueNode, is not a BinaryPart')
  }

  const retval = transformAstSketchLines({
    ast,
    selectionRanges,
    transformInfos: transforms,
    memVars: kclManager.variables,
    referenceSegName: '',
    forceValueUsedInTransform: distanceExpression,
  })
  if (err(retval)) return Promise.reject(retval)

  const { modifiedAst: _modifiedAst, pathToNodeMap } = retval

  return {
    modifiedAst: _modifiedAst,
    pathToNodeMap,
    exprInsertIndex:
      'variableName' in length &&
      length.variableName &&
      length.insertIndex !== undefined
        ? length.insertIndex
        : -1,
  }
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
  exprInsertIndex: number
}> {
  const angleLength = angleLengthInfo({ selectionRanges, angleOrLength })
  if (err(angleLength)) return Promise.reject(angleLength)

  const { transforms } = angleLength
  const sketched = transformAstSketchLines({
    ast: structuredClone(kclManager.ast),
    selectionRanges,
    transformInfos: transforms,
    memVars: kclManager.variables,
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
  let calcIdentifier = createName(['turns'], 'ZERO')
  if (isReferencingYAxisAngle) {
    calcIdentifier = createName(
      ['turns'],
      forceVal < 0 ? 'THREE_QUARTER_TURN' : 'QUARTER_TURN'
    )
    forceVal = normaliseAngle(forceVal + (forceVal < 0 ? 90 : -90))
  } else if (isReferencingXAxisAngle) {
    calcIdentifier = createName(
      ['turns'],
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
  if (!isExprBinaryPart(valueNode))
    return Promise.reject('Invalid valueNode, is not a BinaryPart')
  let finalValue = removeDoubleNegatives(valueNode, sign, variableName)
  if (
    isReferencingYAxisAngle ||
    (isReferencingXAxisAngle && calcIdentifier.name.name !== 'ZERO')
  ) {
    finalValue = createBinaryExpressionWithUnary([calcIdentifier, finalValue])
  }

  const retval = transformAstSketchLines({
    ast: structuredClone(kclManager.ast),
    selectionRanges,
    transformInfos: transforms,
    memVars: kclManager.variables,
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
    exprInsertIndex: variableName ? newVariableInsertIndex : -1,
  }
}
