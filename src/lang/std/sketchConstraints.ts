import { Range, TooTip } from '../../useStore'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
  Program,
  VariableDeclarator,
} from '../abstractSyntaxTree'
import { replaceSketchLine } from './sketch'
import { ProgramMemory, SketchGroup } from '../executor'
import { InternalFn, TransformCallback } from './stdTypes'

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

export const segLen: InternalFn = (
  _,
  segName: string,
  sketchGroup: SketchGroup
): number => {
  const line = sketchGroup.value.find((seg) => seg.name === segName)
  if (!line) return 0 // maybe this should throw, but the language doesn't have a way to handle errors yet
  const result = Math.sqrt(
    (line.from[1] - line.to[1]) ** 2 + (line.from[0] - line.to[0]) ** 2
  )
  return result
}
