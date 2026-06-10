import type { Node } from '@rust/kcl-lib/bindings/Node'

import { removeDoubleNegatives } from '@src/components/AvailableVarsHelpers'
import {
  GetInfoModal,
  createInfoModal,
} from '@src/components/SetHorVertDistanceModal'
import type { ExecutingEditor } from '@src/lang/ExecutingEditor'
import { createLiteral, createVariableDeclaration } from '@src/lang/create'
import { toolTips } from '@src/lang/langHelpers'
import { getNodeFromPath } from '@src/lang/queryAst'
import { isSketchVariablesLinked } from '@src/lang/std/sketchConstraints'
import {
  getTransformInfos,
  isExprBinaryPart,
  transformSecondarySketchLinesTagFirst,
} from '@src/lang/std/sketchcombos'
import type { TransformInfo } from '@src/lang/std/stdTypes'
import type { PathToNodeMap } from '@src/lang/util'
import {
  type Expr,
  type Program,
  type VariableDeclarator,
  isPathToNode,
} from '@src/lang/wasm'
import { cleanErrs, err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

const getModalInfo = createInfoModal(GetInfoModal)

export function horzVertDistanceInfo({
  selectionRanges,
  constraint,
  executingEditor,
  wasmInstance,
}: {
  selectionRanges: Selections
  constraint: 'setHorzDistance' | 'setVertDistance'
  executingEditor: ExecutingEditor
  wasmInstance: ModuleType
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
    }
  | Error {
  const _nodes = selectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<Expr>(
      executingEditor.ast,
      codeRef.pathToNode,
      wasmInstance
    )
    if (err(tmp)) return tmp
    return tmp.node
  })
  const [hasErr, , nodesWErrs] = cleanErrs(_nodes)

  if (hasErr) return nodesWErrs[0]
  const nodes = _nodes as Expr[]

  const _varDecs = selectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<VariableDeclarator>(
      executingEditor.ast,
      codeRef.pathToNode,
      wasmInstance,
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
    isSketchVariablesLinked(secondary, primaryLine, executingEditor.ast)
  )
  const isAllTooltips = nodes.every(
    (node) =>
      node?.type === 'CallExpressionKw' &&
      [...toolTips].includes(node.callee.name.name as any)
  )

  const theTransforms = getTransformInfos(
    {
      ...selectionRanges,
      graphSelections: selectionRanges.graphSelections.slice(1),
    },
    executingEditor.ast,
    constraint,
    wasmInstance
  )
  const _enableEqual =
    secondaryVarDecs.length === 1 &&
    isAllTooltips &&
    isOthersLinkedToPrimary &&
    theTransforms.every(Boolean)
  return { enabled: _enableEqual, transforms: theTransforms }
}

export async function applyConstraintHorzVertDistance({
  selectionRanges,
  constraint,
  executingEditor,
}: {
  selectionRanges: Selections
  constraint: 'setHorzDistance' | 'setVertDistance'
  executingEditor: ExecutingEditor
}): Promise<{
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
  exprInsertIndex: number
}> {
  const info = horzVertDistanceInfo({
    selectionRanges: selectionRanges,
    constraint,
    executingEditor,
    wasmInstance: await executingEditor.wasmInstancePromise,
  })
  if (err(info)) return Promise.reject(info)
  const transformInfos = info.transforms
  const transformed = transformSecondarySketchLinesTagFirst({
    ast: structuredClone(executingEditor.ast),
    selectionRanges,
    transformInfos,
    memVars: executingEditor.variables,
    wasmInstance: await executingEditor.wasmInstancePromise,
  })
  if (err(transformed)) return Promise.reject(transformed)
  const { modifiedAst, tagInfo, valueUsedInTransform, pathToNodeMap } =
    transformed
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
    initialVariableName: constraint === 'setHorzDistance' ? 'xDis' : 'yDis',
    selectionRanges,
  })
  if (
    !variableName &&
    segName === tagInfo?.tag &&
    value === valueUsedInTransform
  ) {
    return {
      modifiedAst,
      pathToNodeMap,
      exprInsertIndex: -1,
    }
  } else {
    if (!isExprBinaryPart(valueNode))
      return Promise.reject('Invalid valueNode, is not a BinaryPart')
    let finalValue = removeDoubleNegatives(
      valueNode,
      sign,
      await executingEditor.wasmInstancePromise,
      variableName
    )
    // transform again but forcing certain values
    const transformed = transformSecondarySketchLinesTagFirst({
      ast: executingEditor.ast,
      selectionRanges,
      transformInfos,
      memVars: executingEditor.variables,
      forceSegName: segName,
      forceValueUsedInTransform: finalValue,
      wasmInstance: await executingEditor.wasmInstancePromise,
    })

    if (err(transformed)) return Promise.reject(transformed)
    const { modifiedAst: _modifiedAst, pathToNodeMap } = transformed
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
    return {
      modifiedAst: _modifiedAst,
      pathToNodeMap,
      exprInsertIndex,
    }
  }
}

export function applyConstraintHorzVertAlign({
  selectionRanges,
  constraint,
  wasmInstance,
  executingEditor,
}: {
  selectionRanges: Selections
  constraint: 'setHorzDistance' | 'setVertDistance'
  wasmInstance: ModuleType
  executingEditor: ExecutingEditor
}):
  | {
      modifiedAst: Node<Program>
      pathToNodeMap: PathToNodeMap
    }
  | Error {
  const info = horzVertDistanceInfo({
    selectionRanges,
    constraint,
    executingEditor,
    wasmInstance,
  })
  if (err(info)) return info
  const transformInfos = info.transforms
  let finalValue = createLiteral(0, wasmInstance)
  const retval = transformSecondarySketchLinesTagFirst({
    ast: executingEditor.ast,
    selectionRanges,
    transformInfos,
    memVars: executingEditor.variables,
    forceValueUsedInTransform: finalValue,
    wasmInstance,
  })
  if (err(retval)) return retval
  const { modifiedAst, pathToNodeMap } = retval
  return {
    modifiedAst: modifiedAst,
    pathToNodeMap,
  }
}
