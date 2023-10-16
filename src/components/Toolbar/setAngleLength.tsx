import { toolTips } from '../../useStore'
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
import { kclManager } from 'lang/KclSinglton'

const getModalInfo = createSetAngleLengthModal(SetAngleLengthModal)

export function setAngleLengthInfo({
  selectionRanges,
  angleOrLength = 'setLength',
}: {
  selectionRanges: Selections
  angleOrLength?: 'setLength' | 'setAngle'
}) {
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

  const transforms = getTransformInfos(
    selectionRanges,
    kclManager.ast,
    angleOrLength
  )
  const enabled = isAllTooltips && transforms.every(Boolean)
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
  const { transforms } = setAngleLengthInfo({ selectionRanges, angleOrLength })
  const { valueUsedInTransform } = transformAstSketchLines({
    ast: JSON.parse(JSON.stringify(kclManager.ast)),
    selectionRanges,
    transformInfos: transforms,
    programMemory: kclManager.programMemory,
    referenceSegName: '',
  })
  try {
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
    let calcIdentifier = createIdentifier('_0')
    if (isReferencingYAxisAngle) {
      calcIdentifier = createIdentifier(forceVal < 0 ? '_270' : '_90')
      forceVal = normaliseAngle(forceVal + (forceVal < 0 ? 90 : -90))
    } else if (isReferencingXAxisAngle) {
      calcIdentifier = createIdentifier(Math.abs(forceVal) > 90 ? '_180' : '_0')
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
      (isReferencingXAxisAngle && calcIdentifier.name !== '_0')
    ) {
      finalValue = createBinaryExpressionWithUnary([calcIdentifier, finalValue])
    }

    const { modifiedAst: _modifiedAst, pathToNodeMap } =
      transformAstSketchLines({
        ast: JSON.parse(JSON.stringify(kclManager.ast)),
        selectionRanges,
        transformInfos: transforms,
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
    return {
      modifiedAst: _modifiedAst,
      pathToNodeMap,
    }
  } catch (e) {
    console.log('erorr', e)
    throw e
  }
}
