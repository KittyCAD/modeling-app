import { ArtifactGraph } from "lang/std/artifactGraph";
import { Selections } from "lib/selections";
import { Expr } from "wasm-lib/kcl/bindings/Expr";
import { Program } from "wasm-lib/kcl/bindings/Program";
import { Node } from 'wasm-lib/kcl/bindings/Node'
import { PathToNode, VariableDeclarator } from "lang/wasm";
import { getPathToExtrudeForSegmentSelection, mutateAstWithTagForSketchSegment } from "./addEdgeTreatment";
import { getNodeFromPath } from "lang/queryAst";
import { err } from "lib/trap";
import { createLiteral, createIdentifier, findUniqueName, createCallExpressionStdLib, createObjectExpression, createArrayExpression, createVariableDeclaration } from "lang/modifyAst";
import { KCL_DEFAULT_CONSTANT_PREFIXES } from "lib/constants";

export function addShell({
  node,
  selection,
  artifactGraph,
  thickness,
}: {
  node: Node<Program>
  selection: Selections
  artifactGraph: ArtifactGraph
  thickness: Expr
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(node)

  // Look up the corresponding extrude
  const clonedAstForGetExtrude = structuredClone(modifiedAst)
  const extrudeLookupResult = getPathToExtrudeForSegmentSelection(
    clonedAstForGetExtrude,
    selection,
    artifactGraph
  )
  if (err(extrudeLookupResult)) {
    return new Error("Couldn't find extrude")
  }

  const extrudeNode = getNodeFromPath<VariableDeclarator>(
    modifiedAst,
    extrudeLookupResult.pathToExtrudeNode,
    'VariableDeclarator'
  )
  if (err(extrudeNode)) {
    return extrudeNode
  }

  const expressions: Expr[] = []
  for (const graphSelection of selection.graphSelections) {
    // Get the sketch ref from the selection
    const sketchNode = getNodeFromPath<VariableDeclarator>(
      modifiedAst,
      graphSelection.codeRef.pathToNode,
      'VariableDeclarator'
    )
    if (err(sketchNode)) {
      return sketchNode
    }

    const selectedArtifact = graphSelection.artifact
    if (!selectedArtifact || !selectedArtifact) {
      return new Error('Bad artifact')
    }

    // Check on the selection, and handle the wall vs cap casees
    let expr: Expr
    if (selectedArtifact.type === 'cap') {
      expr = createLiteral(selectedArtifact.subType)
    } else if (selectedArtifact.type === 'wall') {
      const tagResult = mutateAstWithTagForSketchSegment(
        modifiedAst,
        extrudeLookupResult.pathToSegmentNode
      )
      if (err(tagResult)) return tagResult
      const { tag } = tagResult
      expr = createIdentifier(tag)
    } else {
      continue
    }
    expressions.push(expr)
  }

  const name = findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.SHELL)
  const shell = createCallExpressionStdLib('shell', [
    createObjectExpression({
      faces: createArrayExpression(expressions),
      thickness,
    }),
    createIdentifier(extrudeNode.node.id.name),
  ])
  const declaration = createVariableDeclaration(name, shell)

  // TODO: check if we should append at the end like here or right after the extrude
  modifiedAst.body.push(declaration)
  const pathToNode: PathToNode = [
    ['body', ''],
    [modifiedAst.body.length - 1, 'index'],
    ['declarations', 'VariableDeclaration'],
    ['0', 'index'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpression'],
    [0, 'index'],
  ]
  return {
    modifiedAst,
    pathToNode,
  }
}