import { getNodeFromPath } from 'lang/queryAst'
import { ToolTip, toolTips } from 'lang/langHelpers'
import {
  Program,
  VariableDeclarator,
  CallExpression,
  Sketch,
  SourceRange,
  Path,
  PathToNode,
  Expr,
  topLevelRange,
} from '../wasm'
import { err } from 'lib/trap'

export function getSketchSegmentFromPathToNode(
  sketch: Sketch,
  ast: Program,
  pathToNode: PathToNode
):
  | {
      segment: Sketch['paths'][number]
      index: number
    }
  | Error {
  // TODO: once pathTodNode is stored on program memory as part of execution,
  // we can check if the pathToNode matches the pathToNode of the sketch.
  // For now we fall back to the sourceRange
  const nodeMeta = getNodeFromPath<Expr>(ast, pathToNode)
  if (err(nodeMeta)) return nodeMeta

  const node = nodeMeta.node
  if (!node || typeof node.start !== 'number' || !node.end)
    return new Error('no node found')
  const sourceRange = topLevelRange(node.start, node.end)
  return getSketchSegmentFromSourceRange(sketch, sourceRange)
}
export function getSketchSegmentFromSourceRange(
  sketch: Sketch,
  [rangeStart, rangeEnd]: SourceRange
):
  | {
      segment: Sketch['paths'][number]
      index: number
    }
  | Error {
  const lineIndex = sketch.paths.findIndex(
    ({ __geoMeta: { sourceRange } }: Path) =>
      sourceRange[0] <= rangeStart && sourceRange[1] >= rangeEnd
  )
  const line = sketch.paths[lineIndex]
  if (line) {
    return {
      segment: line,
      index: lineIndex,
    }
  }
  const startSourceRange = sketch.start?.__geoMeta.sourceRange
  if (
    startSourceRange &&
    startSourceRange[0] <= rangeStart &&
    startSourceRange[1] >= rangeEnd &&
    sketch.start
  )
    return { segment: { ...sketch.start, type: 'Base' }, index: -1 }
  return new Error('could not find matching segment')
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
  if (
    !firstCallExp ||
    !toolTips.includes(firstCallExp?.callee?.name as ToolTip)
  )
    return false
  // convention for sketch fns is that the second argument is the sketch
  const secondArg = firstCallExp?.arguments[1]
  if (!secondArg || secondArg?.type !== 'Identifier') return false
  if (secondArg.name === primaryVarDec?.id?.name) return true

  let nextVarDec: VariableDeclarator | undefined
  for (const node of ast.body) {
    if (node.type !== 'VariableDeclaration') continue
    if (node.declaration.id.name === secondArg.name) {
      nextVarDec = node.declaration
      break
    }
  }
  if (!nextVarDec) return false
  return isSketchVariablesLinked(nextVarDec, primaryVarDec, ast)
}
