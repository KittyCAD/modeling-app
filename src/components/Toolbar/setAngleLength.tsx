import { removeDoubleNegatives } from '@src/components/AvailableVarsHelpers'
import {
  SetAngleLengthModal,
  createSetAngleLengthModal,
} from '@src/components/SetAngleLengthModal'
import { angleLengthInfo } from '@src/components/Toolbar/angleLengthInfo'
import {
  createBinaryExpressionWithUnary,
  createLocalName,
  createName,
  createVariableDeclaration,
} from '@src/lang/create'
import type { PathToNodeMap } from '@src/lang/util'
import {
  isExprBinaryPart,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'
import { isPathToNode, type Expr, type Program } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { kclManager } from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import { normaliseAngle } from '@src/lib/utils'

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
  const angleLength = angleLengthInfo({ selectionRanges, kclManager })
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
  currentCode,
}: {
  selectionRanges: Selections
  angleOrLength?: 'setLength' | 'setAngle'
  currentCode: string
}): Promise<{
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
  exprInsertIndex: number
}> {
  const angleLength = angleLengthInfo({
    selectionRanges,
    angleOrLength,
    kclManager,
  })
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

  let forceVal = valueUsedInTransform || ''
  // TODO it would be better to preserve the units, but its an edge case for now.
  let degrees
  if (forceVal.endsWith('rad')) {
    degrees =
      Number(forceVal.substring(0, forceVal.length - 3)) * (180 / Math.PI)
  } else {
    if (forceVal.endsWith('deg')) {
      forceVal = forceVal.substring(0, forceVal.length - 3)
    }
    degrees = Number(forceVal)
  }

  let calcIdentifier = createName(['turns'], 'ZERO')
  if (isReferencingYAxisAngle) {
    calcIdentifier = createName(
      ['turns'],
      degrees < 0 ? 'THREE_QUARTER_TURN' : 'QUARTER_TURN'
    )
    degrees = normaliseAngle(degrees + (degrees < 0 ? 90 : -90))
  } else if (isReferencingXAxisAngle) {
    calcIdentifier = createName(
      ['turns'],
      Math.abs(degrees) > 90 ? 'HALF_TURN' : 'ZERO'
    )
    degrees = Math.abs(degrees) > 90 ? normaliseAngle(degrees - 180) : forceVal
  }
  const value = degrees === 0 ? String(degrees) : String(degrees) + 'deg'
  const { valueNode, variableName, newVariableInsertIndex, sign } =
    await getModalInfo({
      value,
      valueName: angleOrLength === 'setAngle' ? 'angle' : 'length',
      shouldCreateVariable: true,
      selectionRanges,
      currentCode,
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
      if (isPathToNode(pathToNode)) {
        const index = pathToNode.findIndex((a) => a[0] === 'body') + 1
        pathToNode[index][0] = Number(pathToNode[index][0]) + 1
      }
    })
  }
  return {
    modifiedAst: _modifiedAst,
    pathToNodeMap,
    exprInsertIndex: variableName ? newVariableInsertIndex : -1,
  }
}
