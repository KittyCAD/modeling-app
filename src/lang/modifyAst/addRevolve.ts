import { err } from 'lib/trap'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from 'lib/constants'
import {
  Program,
  PathToNode,
  Expr,
  CallExpression,
  VariableDeclarator,
  CallExpressionKw,
  ArtifactGraph,
} from 'lang/wasm'
import { Selections } from 'lib/selections'
import { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createLiteral,
  createLocalName,
  findUniqueName,
  createVariableDeclaration,
  createCallExpressionStdLibKw,
  createLabeledArg,
} from 'lang/modifyAst'
import {
  ARG_INDEX_FIELD,
  getNodeFromPath,
  LABELED_ARG_FIELD,
} from 'lang/queryAst'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import {
  mutateAstWithTagForSketchSegment,
  getEdgeTagCall,
} from 'lang/modifyAst/addEdgeTreatment'
import { Artifact, getPathsFromArtifact } from 'lang/std/artifactGraph'
import { kclManager } from 'lib/singletons'

export function getAxisExpressionAndIndex(
  axisOrEdge: 'Axis' | 'Edge',
  axis: string | undefined,
  edge: Selections | undefined,
  ast: Node<Program>
) {
  let generatedAxis
  let axisDeclaration: PathToNode | null = null
  let axisIndexIfAxis: number | undefined = undefined

  if (axisOrEdge === 'Edge' && edge) {
    const pathToAxisSelection = getNodePathFromSourceRange(
      ast,
      edge.graphSelections[0]?.codeRef.range
    )
    const lineNode = getNodeFromPath<CallExpression | CallExpressionKw>(
      ast,
      pathToAxisSelection,
      ['CallExpression', 'CallExpressionKw']
    )
    if (err(lineNode)) return lineNode

    const tagResult = mutateAstWithTagForSketchSegment(ast, pathToAxisSelection)

    // Have the tag whether it is already created or a new one is generated
    if (err(tagResult)) return tagResult
    const { tag } = tagResult
    const axisSelection = edge?.graphSelections[0]?.artifact
    if (!axisSelection) return new Error('Generated axis selection is missing.')
    generatedAxis = getEdgeTagCall(tag, axisSelection)
    if (
      axisSelection.type === 'segment' ||
      axisSelection.type === 'path' ||
      axisSelection.type === 'edgeCut'
    ) {
      axisDeclaration = axisSelection.codeRef.pathToNode
      if (!axisDeclaration)
        return new Error('Expected to fine axis declaration')
      const axisIndexInPathToNode =
        axisDeclaration.findIndex((a) => a[0] === 'body') + 1
      const value = axisDeclaration[axisIndexInPathToNode][0]
      if (typeof value !== 'number')
        return new Error('expected axis index value to be a number')
      axisIndexIfAxis = value
    }
  } else if (axisOrEdge === 'Axis' && axis) {
    generatedAxis = createLiteral(axis)
  }

  return {
    generatedAxis,
    axisIndexIfAxis,
  }
}

export function revolveSketch(
  ast: Node<Program>,
  pathToSketchNode: PathToNode,
  angle: Expr = createLiteral(4),
  axisOrEdge: 'Axis' | 'Edge',
  axis: string,
  edge: Selections,
  artifactGraph: ArtifactGraph,
  artifact?: Artifact
):
  | {
      modifiedAst: Node<Program>
      pathToSketchNode: PathToNode
      pathToRevolveArg: PathToNode
    }
  | Error {
  const orderedSketchNodePaths = getPathsFromArtifact({
    artifact: artifact,
    sketchPathToNode: pathToSketchNode,
    artifactGraph,
    ast: kclManager.ast,
  })
  if (err(orderedSketchNodePaths)) return orderedSketchNodePaths
  const clonedAst = structuredClone(ast)
  const sketchNode = getNodeFromPath(clonedAst, pathToSketchNode)
  if (err(sketchNode)) return sketchNode
  const sketchVariableDeclaratorNode = getNodeFromPath<VariableDeclarator>(
    clonedAst,
    pathToSketchNode,
    'VariableDeclarator'
  )
  if (err(sketchVariableDeclaratorNode)) return sketchVariableDeclaratorNode
  const { node: sketchVariableDeclarator } = sketchVariableDeclaratorNode

  const getAxisResult = getAxisExpressionAndIndex(axisOrEdge, axis, edge, ast)
  if (err(getAxisResult)) return getAxisResult
  const { generatedAxis, axisIndexIfAxis } = getAxisResult
  if (!generatedAxis) return new Error('Generated axis selection is missing.')

  const revolveCall = createCallExpressionStdLibKw(
    'revolve',
    createLocalName(sketchVariableDeclarator.id.name),
    [createLabeledArg('angle', angle), createLabeledArg('axis', generatedAxis)]
  )

  // We're not creating a pipe expression,
  // but rather a separate constant for the extrusion
  const name = findUniqueName(clonedAst, KCL_DEFAULT_CONSTANT_PREFIXES.REVOLVE)
  const VariableDeclaration = createVariableDeclaration(name, revolveCall)
  const lastSketchNodePath =
    orderedSketchNodePaths[orderedSketchNodePaths.length - 1]
  let sketchIndexInBody = Number(lastSketchNodePath[1][0])
  if (typeof sketchIndexInBody !== 'number') {
    return new Error('expected sketchIndexInBody to be a number')
  }

  // If an axis was selected in KCL, find the max index to insert the revolve command
  if (axisIndexIfAxis) {
    sketchIndexInBody = Math.max(sketchIndexInBody, axisIndexIfAxis)
  }

  clonedAst.body.splice(sketchIndexInBody + 1, 0, VariableDeclaration)

  const pathToRevolveArg: PathToNode = [
    ['body', ''],
    [sketchIndexInBody + 1, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpressionKw'],
    [0, ARG_INDEX_FIELD],
    ['arg', LABELED_ARG_FIELD],
  ]

  return {
    modifiedAst: clonedAst,
    pathToSketchNode: [...pathToSketchNode.slice(0, -1), [-1, 'index']],
    pathToRevolveArg,
  }
}
