import { toolTips } from '../../useStore'
import { Selections } from 'lib/selections'
import { Program, ProgramMemory, Value } from '../../lang/wasm'
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
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'

export function horzVertInfo(
  selectionRanges: Selections,
  horOrVert: 'vertical' | 'horizontal'
):
  | {
      transforms: TransformInfo[]
      enabled: boolean
    }
  | Error {
  const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
    getNodePathFromSourceRange(kclManager.ast, range)
  )
  const _nodes = paths.map((pathToNode) => {
    const tmp = getNodeFromPath<Value>(kclManager.ast, pathToNode)
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

  const theTransforms = getTransformInfos(
    selectionRanges,
    kclManager.ast,
    horOrVert
  )
  if (err(theTransforms)) return theTransforms

  const _enableHorz = isAllTooltips && theTransforms.every(Boolean)
  return { enabled: _enableHorz, transforms: theTransforms }
}

export function applyConstraintHorzVert(
  selectionRanges: Selections,
  horOrVert: 'vertical' | 'horizontal',
  ast: Program,
  programMemory: ProgramMemory
):
  | {
      modifiedAst: Program
      pathToNodeMap: PathToNodeMap
    }
  | Error {
  const info = horzVertInfo(selectionRanges, horOrVert)
  if (err(info)) return info
  const transformInfos = info.transforms

  return transformAstSketchLines({
    ast,
    selectionRanges,
    transformInfos,
    programMemory,
    referenceSegName: '',
  })
}
