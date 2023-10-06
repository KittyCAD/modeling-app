import { useState, useEffect } from 'react'
import { create } from 'react-modal-promise'
import { Selections, toolTips, useStore } from '../../useStore'
import { BinaryPart, Program, Value, VariableDeclarator } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  TransformInfo,
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
  PathToNodeMap,
} from '../../lang/std/sketchcombos'
import { GetInfoModal } from '../SetHorVertDistanceModal'
import { createVariableDeclaration } from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { updateCursors } from '../../lang/util'
import { kclManager } from 'lang/KclSinglton'
import { useModelingContext } from 'hooks/useModelingContext'

const getModalInfo = create(GetInfoModal as any)

export const SetAngleBetween = () => {
  const { guiMode, selectionRanges, setCursor } = useStore((s) => ({
    guiMode: s.guiMode,
    selectionRanges: s.selectionRanges,
    setCursor: s.setCursor,
  }))
  const [enable, setEnable] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  const { context } = useModelingContext()
  useEffect(() => {
    const { enabled, transforms } = angleBetweenInfo({ selectionRanges })
    setTransformInfos(transforms)
    setEnable(enabled)
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  return (
    <button
      onClick={async () => {
        if (!transformInfos) return
        const { modifiedAst, tagInfo, valueUsedInTransform, pathToNodeMap } =
          transformSecondarySketchLinesTagFirst({
            ast: JSON.parse(JSON.stringify(kclManager.ast)),
            selectionRanges,
            transformInfos,
            programMemory: kclManager.programMemory,
          })
        const {
          segName,
          value,
          valueNode,
          variableName,
          newVariableInsertIndex,
          sign,
        }: {
          segName: string
          value: number
          valueNode: Value
          variableName?: string
          newVariableInsertIndex: number
          sign: number
        } = await getModalInfo({
          segName: tagInfo?.tag,
          isSegNameEditable: !tagInfo?.isTagExisting,
          value: valueUsedInTransform,
          initialVariableName: 'angle',
        } as any)
        if (segName === tagInfo?.tag && value === valueUsedInTransform) {
          kclManager.updateAst(
            context.defaultPlanes.planes,
            modifiedAst,
            true,
            {
              callBack: updateCursors(
                setCursor,
                selectionRanges,
                pathToNodeMap
              ),
            }
          )
        } else {
          const finalValue = removeDoubleNegatives(
            valueNode as BinaryPart,
            sign,
            variableName
          )
          // transform again but forcing certain values
          const { modifiedAst: _modifiedAst, pathToNodeMap } =
            transformSecondarySketchLinesTagFirst({
              ast: kclManager.ast,
              selectionRanges,
              transformInfos,
              programMemory: kclManager.programMemory,
              forceSegName: segName,
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
        }
      }}
      disabled={!enable}
      title="Set Angle Between"
    >
      Set Angle Between
    </button>
  )
}

export function angleBetweenInfo({
  selectionRanges,
}: {
  selectionRanges: Selections
}) {
  const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
    getNodePathFromSourceRange(kclManager.ast, range)
  )

  const nodes = paths.map(
    (pathToNode) => getNodeFromPath<Value>(kclManager.ast, pathToNode).node
  )
  const varDecs = paths.map(
    (pathToNode) =>
      getNodeFromPath<VariableDeclarator>(
        kclManager.ast,
        pathToNode,
        'VariableDeclarator'
      )?.node
  )
  const primaryLine = varDecs[0]
  const secondaryVarDecs = varDecs.slice(1)
  const isOthersLinkedToPrimary = secondaryVarDecs.every((secondary) =>
    isSketchVariablesLinked(secondary, primaryLine, kclManager.ast)
  )
  const isAllTooltips = nodes.every(
    (node) =>
      node?.type === 'CallExpression' &&
      toolTips.includes(node.callee.name as any)
  )

  const theTransforms = getTransformInfos(
    {
      ...selectionRanges,
      codeBasedSelections: selectionRanges.codeBasedSelections.slice(1),
    },
    kclManager.ast,
    'setAngleBetween'
  )

  const _enableEqual =
    secondaryVarDecs.length === 1 &&
    isAllTooltips &&
    isOthersLinkedToPrimary &&
    theTransforms.every(Boolean)
  return { enabled: _enableEqual, transforms: theTransforms }
}

export async function applyConstraintAngleBetween({
  selectionRanges,
}: // constraint,
{
  selectionRanges: Selections
  // constraint: 'setHorzDistance' | 'setVertDistance'
}): Promise<{
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
}> {
  const transformInfos = angleBetweenInfo({ selectionRanges }).transforms
  const { modifiedAst, tagInfo, valueUsedInTransform, pathToNodeMap } =
    transformSecondarySketchLinesTagFirst({
      ast: JSON.parse(JSON.stringify(kclManager.ast)),
      selectionRanges,
      transformInfos,
      programMemory: kclManager.programMemory,
    })
  const {
    segName,
    value,
    valueNode,
    variableName,
    newVariableInsertIndex,
    sign,
  }: {
    segName: string
    value: number
    valueNode: Value
    variableName?: string
    newVariableInsertIndex: number
    sign: number
  } = await getModalInfo({
    segName: tagInfo?.tag,
    isSegNameEditable: !tagInfo?.isTagExisting,
    value: valueUsedInTransform,
    initialVariableName: 'angle',
  } as any)
  if (segName === tagInfo?.tag && value === valueUsedInTransform) {
    return {
      modifiedAst,
      pathToNodeMap,
    }
    // kclManager.updateAst(modifiedAst, true, {
    // TODO handle cursor
    //   callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
    // })
  }

  const finalValue = removeDoubleNegatives(
    valueNode as BinaryPart,
    sign,
    variableName
  )
  // transform again but forcing certain values
  const { modifiedAst: _modifiedAst, pathToNodeMap: _pathToNodeMap } =
    transformSecondarySketchLinesTagFirst({
      ast: kclManager.ast,
      selectionRanges,
      transformInfos,
      programMemory: kclManager.programMemory,
      forceSegName: segName,
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
    pathToNodeMap: _pathToNodeMap,
  }
  // kclManager.updateAst(_modifiedAst, true, {
  // TODO handle cursor
  //   callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
  // })
}
