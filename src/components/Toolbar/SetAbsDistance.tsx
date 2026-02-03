import type { Node } from '@rust/kcl-lib/bindings/Node'

import { removeDoubleNegatives } from '@src/components/AvailableVarsHelpers'
import {
  SetAngleLengthModal,
  createSetAngleLengthModal,
} from '@src/components/SetAngleLengthModal'
import { createName, createVariableDeclaration } from '@src/lang/create'
import { toolTips } from '@src/lang/langHelpers'
import { getNodeFromPath } from '@src/lang/queryAst'
import type { PathToNodeMap } from '@src/lang/util'
import {
  getTransformInfos,
  isExprBinaryPart,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'
import type { TransformInfo } from '@src/lang/std/stdTypes'
import { isPathToNode, type Expr, type Program } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { KclManager } from '@src/lang/KclManager'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

const getModalInfo = createSetAngleLengthModal(SetAngleLengthModal)

type Constraint = 'xAbs' | 'yAbs' | 'snapToYAxis' | 'snapToXAxis'

export function absDistanceInfo({
  selectionRanges,
  constraint,
  kclManager,
  wasmInstance,
}: {
  selectionRanges: Selections
  constraint: Constraint
  kclManager: KclManager
  wasmInstance: ModuleType
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
  const _nodes = selectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<Expr>(
      kclManager.ast,
      codeRef.pathToNode,
      wasmInstance,
      ['CallExpressionKw']
    )
    if (err(tmp)) return tmp
    return tmp.node
  })
  const _err1 = _nodes.find(err)
  if (err(_err1)) return _err1
  const nodes = _nodes as Expr[]

  const isAllTooltips = nodes.every(
    (node) =>
      node?.type === 'CallExpressionKw' &&
      toolTips.includes(node.callee.name.name as any)
  )

  const transforms = getTransformInfos(
    selectionRanges,
    kclManager.ast,
    disType,
    wasmInstance
  )
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
    selectionRanges.graphSelections.length === 1 &&
    (enableX || enableY)

  return { enabled, transforms }
}

export async function applyConstraintAbsDistance({
  selectionRanges,
  constraint,
  kclManager,
}: {
  selectionRanges: Selections
  constraint: 'xAbs' | 'yAbs'
  kclManager: KclManager
}): Promise<{
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
  exprInsertIndex: number
}> {
  const info = absDistanceInfo({
    selectionRanges,
    constraint,
    kclManager,
    wasmInstance: await kclManager.wasmInstancePromise,
  })
  if (err(info)) return Promise.reject(info)
  const transformInfos = info.transforms

  const transform1 = transformAstSketchLines({
    ast: structuredClone(kclManager.ast),
    selectionRanges,
    transformInfos,
    memVars: kclManager.variables,
    referenceSegName: '',
    wasmInstance: await kclManager.wasmInstancePromise,
  })
  if (err(transform1)) return Promise.reject(transform1)
  const { valueUsedInTransform } = transform1

  let forceVal = valueUsedInTransform || ''
  const { valueNode, variableName, newVariableInsertIndex, sign } =
    await getModalInfo({
      value: forceVal,
      valueName: constraint === 'yAbs' ? 'yDis' : 'xDis',
      selectionRanges,
    })
  if (!isExprBinaryPart(valueNode))
    return Promise.reject('Invalid valueNode, is not a BinaryPart')
  let finalValue = removeDoubleNegatives(
    valueNode,
    sign,
    await kclManager.wasmInstancePromise,
    variableName
  )

  const transform2 = transformAstSketchLines({
    ast: structuredClone(kclManager.ast),
    selectionRanges,
    transformInfos,
    memVars: kclManager.variables,
    referenceSegName: '',
    forceValueUsedInTransform: finalValue,
    wasmInstance: await kclManager.wasmInstancePromise,
  })
  if (err(transform2)) return Promise.reject(transform2)
  const { modifiedAst: _modifiedAst, pathToNodeMap } = transform2

  let exprInsertIndex = -1
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
    exprInsertIndex = newVariableInsertIndex
  }
  return { modifiedAst: _modifiedAst, pathToNodeMap, exprInsertIndex }
}

export function applyConstraintAxisAlign({
  selectionRanges,
  constraint,
  kclManager,
  wasmInstance,
}: {
  selectionRanges: Selections
  constraint: 'snapToYAxis' | 'snapToXAxis'
  kclManager: KclManager
  wasmInstance: ModuleType
}):
  | {
      modifiedAst: Node<Program>
      pathToNodeMap: PathToNodeMap
    }
  | Error {
  const info = absDistanceInfo({
    selectionRanges,
    constraint,
    kclManager,
    wasmInstance,
  })
  if (err(info)) return info
  const transformInfos = info.transforms

  let finalValue = createName(['turns'], 'ZERO')

  return transformAstSketchLines({
    ast: structuredClone(kclManager.ast),
    selectionRanges,
    transformInfos,
    memVars: kclManager.variables,
    referenceSegName: '',
    forceValueUsedInTransform: finalValue,
    wasmInstance,
  })
}
