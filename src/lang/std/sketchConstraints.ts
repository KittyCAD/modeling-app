import { Range, TooTip } from '../../useStore'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
  Program,
  VariableDeclarator,
} from '../../lang/abstractSyntaxTree'
import { replaceSketchLine } from '../../lang/std/sketch'
import { ProgramMemory, SketchGroup } from '../../lang/executor'
import { TransformCallback } from '../../lang/std/stdTypes'
// import { getNodeFromPath, getNodePathFromSourceRange } from '../../lang/abstractSyntaxTree'

export function swapSketchHelper(
  programMemory: ProgramMemory,
  ast: Program,
  range: Range,
  newFnName: TooTip,
  createCallback: TransformCallback
): { modifiedAst: Program } {
  const path = getNodePathFromSourceRange(ast, range)
  const varDec = getNodeFromPath<VariableDeclarator>(
    ast,
    path,
    'VariableDeclarator'
  ).node
  const varName = varDec.id.name
  const sketchGroup = programMemory.root?.[varName]
  if (!sketchGroup || sketchGroup.type !== 'sketchGroup')
    throw new Error('not a sketch group')
  const seg = getSketchSegmentIndexFromSourceRange(sketchGroup, range)
  const { to, from } = seg
  const { modifiedAst } = replaceSketchLine({
    node: ast,
    sourceRange: range,
    programMemory,
    fnName: newFnName,
    to,
    from,
    createCallback,
  })
  return { modifiedAst }
}

function getSketchSegmentIndexFromSourceRange(
  sketchGroup: SketchGroup,
  [rangeStart, rangeEnd]: Range
): SketchGroup['value'][number] {
  const line = sketchGroup.value.find(
    ({ __geoMeta: { sourceRange } }) =>
      sourceRange[0] <= rangeStart && sourceRange[1] >= rangeEnd
  )
  if (!line) throw new Error('could not find matching line')
  return line
}
