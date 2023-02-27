import { Range, TooTip, toolTips } from '../../useStore'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
  Program,
  VariableDeclarator,
  CallExpression,
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

export function getSketchSegmentIndexFromSourceRange(
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
  const line = sketchGroup?.value.find((seg) => seg.name === segName)
  // maybe this should throw, but the language doesn't have a way to handle errors yet
  if (!line) return 0

  return Math.sqrt(
    (line.from[1] - line.to[1]) ** 2 + (line.from[0] - line.to[0]) ** 2
  )
}

export function includedInAll(
  possibleFnCallSwapsForEachCursor: TooTip[][],
  eachHasAtLeastOneOfThese: TooTip[]
): boolean {
  return possibleFnCallSwapsForEachCursor.every((possibleFnCallSwap) =>
    eachHasAtLeastOneOfThese.some((isInclude) =>
      possibleFnCallSwap.includes(isInclude)
    )
  )
}

export function isSketchVariablesLinked(
  secondaryVarDec: VariableDeclarator,
  primaryVarDec: VariableDeclarator,
  ast: Program
): boolean {
  /*
  checks if two callExpressions are part of the same pipe
  if not than checks if the second argument is a variable that is linked to the primary variable declaration
  and will keep checking the second arguments recursively until it runs out of variable declarations
  to check or it finds a match.
  that way it can find fn calls that are linked to each other through variables eg:
  const part001 = startSketchAt([0, 0])
    |> xLineTo(1.69, %)
    |> line([myVar, 0.38], %) // ❗️ <- cursor in this fn call (the primary)
    |> line([0.41, baz], %)
    |> xLine(0.91, %)
    |> angledLine([37, 2], %)
  const yo = line([myVar, 0.38], part001)
    |> line([1, 1], %)
  const yo2 = line([myVar, 0.38], yo)
    |> line([1, 1], %) // ❗️ <- and cursor here (secondary) is linked to the one above through variables
  */
  const secondaryVarName = secondaryVarDec?.id?.name
  if (!secondaryVarName) return false
  if (secondaryVarName === primaryVarDec?.id?.name) return true
  const { init } = secondaryVarDec
  if (
    !init ||
    !(init.type === 'CallExpression' || init.type === 'PipeExpression')
  )
    return false
  const firstCallExp = // first in pipe expression or just the call expression
    init?.type === 'CallExpression' ? init : (init?.body[0] as CallExpression)
  if (!firstCallExp || !toolTips.includes(firstCallExp?.callee?.name as TooTip))
    return false
  // convention for sketch fns is that the second argument is the sketch group
  const secondArg = firstCallExp?.arguments[1]
  if (!secondArg || secondArg?.type !== 'Identifier') return false
  if (secondArg.name === primaryVarDec?.id?.name) return true

  let nextVarDec: VariableDeclarator | undefined
  for (const node of ast.body) {
    if (node.type !== 'VariableDeclaration') continue
    const found = node.declarations.find(
      ({ id }) => id?.name === secondArg.name
    )
    if (!found) continue
    nextVarDec = found
    break
  }
  if (!nextVarDec) return false
  return isSketchVariablesLinked(nextVarDec, primaryVarDec, ast)
}
