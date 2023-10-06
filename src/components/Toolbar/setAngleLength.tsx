import { useState, useEffect } from 'react'
import { create } from 'react-modal-promise'
import { Selections, toolTips, useStore } from '../../useStore'
import { Program, Value } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import {
  PathToNodeMap,
  TransformInfo,
  getTransformInfos,
  transformAstSketchLines,
} from '../../lang/std/sketchcombos'
import { SetAngleLengthModal } from '../SetAngleLengthModal'
import {
  createBinaryExpressionWithUnary,
  createIdentifier,
  createVariableDeclaration,
} from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { normaliseAngle } from '../../lib/utils'
import { updateCursors } from '../../lang/util'
import { kclManager } from 'lang/KclSinglton'
import { useModelingContext } from 'hooks/useModelingContext'

const getModalInfo = create(SetAngleLengthModal as any)

type ButtonType = 'setAngle' | 'setLength'

const buttonLabels: Record<ButtonType, string> = {
  setAngle: 'Set Angle',
  setLength: 'Set Length',
}

export const SetAngleLength = ({
  angleOrLength,
}: {
  angleOrLength: ButtonType
}) => {
  const { guiMode, selectionRanges, setCursor } = useStore((s) => ({
    guiMode: s.guiMode,
    selectionRanges: s.selectionRanges,
    setCursor: s.setCursor,
  }))
  const [enableAngLen, setEnableAngLen] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  const { context } = useModelingContext()
  useEffect(() => {
    const { enabled, transforms } = setAngleLengthInfo({
      selectionRanges,
      angleOrLength,
    })

    setTransformInfos(transforms)
    setEnableAngLen(enabled)
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  return (
    <button
      onClick={async () => {
        if (!transformInfos) return
        const { valueUsedInTransform } = transformAstSketchLines({
          ast: JSON.parse(JSON.stringify(kclManager.ast)),
          selectionRanges,
          transformInfos,
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
            calcIdentifier = createIdentifier(
              Math.abs(forceVal) > 90 ? '_180' : '_0'
            )
            forceVal =
              Math.abs(forceVal) > 90
                ? normaliseAngle(forceVal - 180)
                : forceVal
          }
          const { valueNode, variableName, newVariableInsertIndex, sign } =
            await getModalInfo({
              value: forceVal,
              valueName: angleOrLength === 'setAngle' ? 'angle' : 'length',
              shouldCreateVariable: true,
            } as any)
          let finalValue = removeDoubleNegatives(valueNode, sign, variableName)
          if (
            isReferencingYAxisAngle ||
            (isReferencingXAxisAngle && calcIdentifier.name !== '_0')
          ) {
            finalValue = createBinaryExpressionWithUnary([
              calcIdentifier,
              finalValue,
            ])
          }

          const { modifiedAst: _modifiedAst, pathToNodeMap } =
            transformAstSketchLines({
              ast: JSON.parse(JSON.stringify(kclManager.ast)),
              selectionRanges,
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

          kclManager.updateAst(
            context.defaultPlanes.planes,
            _modifiedAst,
            true,
            {
              callBack: updateCursors(
                setCursor,
                selectionRanges,
                pathToNodeMap
              ),
            }
          )
        } catch (e) {
          console.log('erorr', e)
        }
      }}
      disabled={!enableAngLen}
      title={buttonLabels[angleOrLength]}
    >
      {buttonLabels[angleOrLength]}
    </button>
  )
}

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
      } as any)
    let finalValue = removeDoubleNegatives(valueNode, sign, variableName)
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
    // kclManager.updateAst(_modifiedAst, true, {
    //   callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
    // })
  } catch (e) {
    console.log('erorr', e)
    throw e
  }
}
