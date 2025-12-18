import type { Node } from '@rust/kcl-lib/bindings/Node'

import { toolTips } from '@src/lang/langHelpers'
import { getNodeFromPath } from '@src/lang/queryAst'
import { isSketchVariablesLinked } from '@src/lang/std/sketchConstraints'
import type { PathToNodeMap } from '@src/lang/util'
import {
  getTransformInfos,
  transformSecondarySketchLinesTagFirst,
} from '@src/lang/std/sketchcombos'
import type { TransformInfo } from '@src/lang/std/stdTypes'
import type {
  Expr,
  Program,
  VariableDeclarator,
  VariableMap,
} from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export function setEqualLengthInfo({
  selectionRanges,
  ast,
  wasmInstance,
}: {
  selectionRanges: Selections
  ast: Node<Program>
  wasmInstance: ModuleType
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
    }
  | Error {
  const _nodes = selectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<Expr>(ast, codeRef.pathToNode)
    if (err(tmp)) return tmp
    return tmp.node
  })
  const _err1 = _nodes.find(err)
  if (err(_err1)) return _err1
  const nodes = _nodes as Expr[]

  const _varDecs = selectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<VariableDeclarator>(
      ast,
      codeRef.pathToNode,
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
    isSketchVariablesLinked(secondary, primaryLine, ast)
  )
  const isAllTooltips = nodes.every(
    (node) =>
      node?.type === 'CallExpressionKw' &&
      toolTips.includes(node.callee.name.name as any)
  )

  const transforms = getTransformInfos(
    {
      ...selectionRanges,
      graphSelections: selectionRanges.graphSelections.slice(1),
    },
    ast,
    'equalLength',
    wasmInstance
  )
  if (err(transforms)) return transforms

  const enabled =
    !!secondaryVarDecs.length &&
    isAllTooltips &&
    isOthersLinkedToPrimary &&
    transforms.every(Boolean)

  return { enabled, transforms }
}

export function applyConstraintEqualLength({
  selectionRanges,
  ast,
  variables,
  wasmInstance,
}: {
  selectionRanges: Selections
  ast: Node<Program>
  variables: VariableMap
  wasmInstance: ModuleType
}):
  | {
      modifiedAst: Node<Program>
      pathToNodeMap: PathToNodeMap
    }
  | Error {
  const info = setEqualLengthInfo({ selectionRanges, ast, wasmInstance })
  if (err(info)) return info
  const { transforms } = info

  const transform = transformSecondarySketchLinesTagFirst({
    ast,
    selectionRanges,
    transformInfos: transforms,
    memVars: variables,
    wasmInstance,
  })
  if (err(transform)) return transform
  const { modifiedAst, pathToNodeMap } = transform

  return { modifiedAst, pathToNodeMap }
}
