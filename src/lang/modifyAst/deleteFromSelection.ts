import type { Models } from '@kittycad/lib'
import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLiteral,
  createObjectExpression,
} from '@src/lang/create'
import { deleteEdgeTreatment } from '@src/lang/modifyAst/addEdgeTreatment'
import {
  getNodeFromPath,
  traverse,
  findPipesWithImportAlias,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  expandCap,
  expandPlane,
  expandWall,
  getArtifactOfTypes,
  getArtifactsOfTypes,
  getFaceCodeRef,
} from '@src/lang/std/artifactGraph'
import type {
  ArtifactGraph,
  CallExpressionKw,
  KclValue,
  PathToNode,
  PipeExpression,
  Program,
  VariableDeclarator,
  VariableMap,
} from '@src/lang/wasm'
import type { Selection } from '@src/lib/selections'
import { err, reportRejection } from '@src/lib/trap'
import { isArray, roundOff } from '@src/lib/utils'

export async function deleteFromSelection(
  ast: Node<Program>,
  selection: Selection,
  variables: VariableMap,
  artifactGraph: ArtifactGraph,
  getFaceDetails: (id: string) => Promise<Models['FaceIsPlanar_type']> = () =>
    ({}) as any
): Promise<Node<Program> | Error> {
  const astClone = structuredClone(ast)
  let deletionArtifact = selection.artifact

  // Coerce sketch artifacts to their plane first
  if (selection.artifact?.type === 'startSketchOnPlane') {
    const planeArtifact = getArtifactOfTypes(
      { key: selection.artifact.planeId, types: ['plane'] },
      artifactGraph
    )
    if (!err(planeArtifact)) {
      deletionArtifact = planeArtifact
    }
  } else if (selection.artifact?.type === 'startSketchOnFace') {
    const planeArtifact = getArtifactOfTypes(
      { key: selection.artifact.faceId, types: ['plane'] },
      artifactGraph
    )
    if (!err(planeArtifact)) {
      deletionArtifact = planeArtifact
    }
  }

  if (
    (deletionArtifact?.type === 'plane' ||
      deletionArtifact?.type === 'cap' ||
      deletionArtifact?.type === 'wall') &&
    deletionArtifact?.pathIds?.length
  ) {
    const plane =
      deletionArtifact.type === 'plane'
        ? expandPlane(deletionArtifact, artifactGraph)
        : deletionArtifact.type === 'wall'
          ? expandWall(deletionArtifact, artifactGraph)
          : expandCap(deletionArtifact, artifactGraph)
    for (const path of plane.paths.sort(
      (a, b) => b.codeRef.range?.[0] - a.codeRef.range?.[0]
    )) {
      const varDec = getNodeFromPath<VariableDeclarator>(
        ast,
        path.codeRef.pathToNode,
        'VariableDeclarator'
      )
      if (err(varDec)) return varDec
      const bodyIndex = Number(varDec.shallowPath[1][0])
      astClone.body.splice(bodyIndex, 1)
    }
    // If it's a cap, we're not going to continue and try to
    // delete the extrusion
    if (deletionArtifact.type === 'cap' || deletionArtifact.type === 'wall') {
      // Delete the sketch node, which would not work if
      // we continued down the traditional code path below.
      // faceCodeRef's pathToNode is empty for some reason
      // so using source range instead
      const codeRef = getFaceCodeRef(deletionArtifact)
      if (!codeRef) return new Error('Could not find face code ref')
      const sketchVarDec = getNodePathFromSourceRange(astClone, codeRef.range)
      const sketchBodyIndex = Number(sketchVarDec[1][0])
      astClone.body.splice(sketchBodyIndex, 1)
      return astClone
    }

    // If we coerced the artifact from a sketch to a plane,
    // this is where we hop off after we delete the sketch variable declaration
    if (
      selection.artifact?.type === 'startSketchOnPlane' ||
      selection.artifact?.type === 'startSketchOnFace'
    ) {
      const sketchVarDec = getNodePathFromSourceRange(
        astClone,
        selection.artifact.codeRef.range
      )
      const sketchBodyIndex = Number(sketchVarDec[1][0])
      astClone.body.splice(sketchBodyIndex, 1)
      return astClone
    }
  }

  // Module import and expression case, need to find and delete both
  const statement = getNodeFromPath<ImportStatement>(
    astClone,
    selection.codeRef.pathToNode,
    'ImportStatement'
  )
  if (
    !err(statement) &&
    statement.node.type === 'ImportStatement' &&
    selection.codeRef.pathToNode[1] &&
    typeof selection.codeRef.pathToNode[1][0] === 'number'
  ) {
    const pipes = findPipesWithImportAlias(ast, selection.codeRef.pathToNode)
    for (const { pathToNode: pathToPipeNode } of pipes.reverse()) {
      if (typeof pathToPipeNode[1][0] === 'number') {
        const pipeWithImportAliasIndex = pathToPipeNode[1][0]
        astClone.body.splice(pipeWithImportAliasIndex, 1)
      }
    }

    const importIndex = selection.codeRef.pathToNode[1][0]
    astClone.body.splice(importIndex, 1)
    return astClone
  }

  // Below is all AST-based deletion logic
  const varDec = getNodeFromPath<VariableDeclarator>(
    ast,
    selection?.codeRef?.pathToNode,
    'VariableDeclarator'
  )
  if (err(varDec)) return varDec
  if (
    ((selection?.artifact?.type === 'wall' ||
      selection?.artifact?.type === 'cap') &&
      varDec.node.init.type === 'PipeExpression') ||
    selection.artifact?.type === 'sweep' ||
    selection.artifact?.type === 'plane' ||
    selection.artifact?.type === 'helix' ||
    !selection.artifact // aka expected to be a shell at this point
  ) {
    let extrudeNameToDelete = ''
    let pathToNode: PathToNode | null = null
    if (
      selection.artifact &&
      selection.artifact.type !== 'sweep' &&
      selection.artifact.type !== 'plane' &&
      selection.artifact.type !== 'helix'
    ) {
      const varDecName = varDec.node.id.name
      traverse(astClone, {
        enter: (node, path) => {
          if (node.type === 'VariableDeclaration') {
            const dec = node.declaration
            if (
              dec.init.type === 'CallExpressionKw' &&
              (dec.init.callee.name.name === 'extrude' ||
                dec.init.callee.name.name === 'revolve') &&
              dec.init.unlabeled?.type === 'Name' &&
              dec.init.unlabeled?.name.name === varDecName
            ) {
              pathToNode = path
              extrudeNameToDelete = dec.id.name
            }
            if (
              dec.init.type === 'CallExpressionKw' &&
              dec.init.callee.name.name === 'loft' &&
              dec.init.unlabeled !== null &&
              dec.init.unlabeled.type === 'ArrayExpression' &&
              dec.init.unlabeled.elements.some(
                (a) => a.type === 'Name' && a.name.name === varDecName
              )
            ) {
              pathToNode = path
              extrudeNameToDelete = dec.id.name
            }
          }
        },
      })
      if (!pathToNode) return new Error('Could not find extrude variable')
    } else {
      pathToNode = selection.codeRef.pathToNode
      if (varDec.node.type === 'VariableDeclarator') {
        extrudeNameToDelete = varDec.node.id.name
      } else if (varDec.node.type === 'CallExpressionKw') {
        const callExp = getNodeFromPath<CallExpressionKw>(
          astClone,
          pathToNode,
          ['CallExpressionKw']
        )
        if (err(callExp)) return callExp
        extrudeNameToDelete = callExp.node.callee.name.name
      } else {
        return new Error('Could not find extrude variable or call')
      }
    }

    const expressionIndex = pathToNode[1][0] as number
    astClone.body.splice(expressionIndex, 1)
    if (extrudeNameToDelete) {
      await new Promise((resolve) => {
        ;(async () => {
          const pathsDependingOnExtrude: {
            [id: string]: {
              path: PathToNode
              variable: KclValue
            }
          } = {}
          const roundLiteral = (x: number) => createLiteral(roundOff(x))
          const modificationDetails: {
            parentPipe: PipeExpression['body']
            parentInit: VariableDeclarator
            faceDetails: Models['FaceIsPlanar_type']
            lastKey: number | string
          }[] = []
          const wallArtifact =
            selection.artifact?.type === 'wall'
              ? selection.artifact
              : selection.artifact?.type === 'segment' &&
                  selection.artifact.surfaceId
                ? getArtifactOfTypes(
                    { key: selection.artifact.surfaceId, types: ['wall'] },
                    artifactGraph
                  )
                : null
          if (err(wallArtifact)) return
          if (wallArtifact) {
            const sweep = getArtifactOfTypes(
              { key: wallArtifact.sweepId, types: ['sweep'] },
              artifactGraph
            )
            if (err(sweep)) return
            const wallsWithDependencies = Array.from(
              getArtifactsOfTypes(
                { keys: sweep.surfaceIds, types: ['wall', 'cap'] },
                artifactGraph
              ).values()
            ).filter((wall) => wall?.pathIds?.length)
            const wallIds = wallsWithDependencies.map((wall) => wall.id)

            Object.entries(variables).forEach(([key, _var]) => {
              if (
                _var?.type === 'Face' &&
                wallIds.includes(_var.value.artifactId)
              ) {
                const artifact = getArtifactOfTypes(
                  {
                    key: _var.value.artifactId,
                    types: ['wall', 'cap', 'plane'],
                  },
                  artifactGraph
                )
                if (err(artifact)) return
                const sourceRange = getFaceCodeRef(artifact)?.range
                if (!sourceRange) return
                const pathToStartSketchOn = getNodePathFromSourceRange(
                  astClone,
                  sourceRange
                )
                pathsDependingOnExtrude[_var.value.id] = {
                  path: pathToStartSketchOn,
                  variable: _var,
                }
              }
            })
          }
          for (const { path, variable } of Object.values(
            pathsDependingOnExtrude
          )) {
            // `parentPipe` and `parentInit` are the exact same node, but because it could either be an array or on object node
            // putting them in two different variables was the only way to get TypeScript to stop complaining
            // the reason why we're grabbing the parent and the last key is because we want to mutate the ast
            // so `parent[lastKey]` does the trick, if there's a better way of doing this I'm all years
            const parentPipe = getNodeFromPath<PipeExpression['body']>(
              astClone,
              path.slice(0, -1)
            )
            const parentInit = getNodeFromPath<VariableDeclarator>(
              astClone,
              path.slice(0, -1)
            )
            if (err(parentPipe) || err(parentInit)) {
              return
            }
            if (!variable) return new Error('Could not find sketch')
            const artifactId =
              variable.type === 'Sketch'
                ? variable.value.artifactId
                : variable.type === 'Face'
                  ? variable.value.artifactId
                  : ''
            if (!artifactId) return new Error('Sketch not on anything')
            const onId =
              variable.type === 'Sketch'
                ? variable.value.on.id
                : variable.type === 'Face'
                  ? variable.value.id
                  : ''
            if (!onId) return new Error('Sketch not on anything')
            // Can't kick off multiple requests at once as getFaceDetails
            // is three engine calls in one and they conflict
            const faceDetails = await getFaceDetails(onId)
            if (
              !(
                faceDetails.origin &&
                faceDetails.x_axis &&
                faceDetails.y_axis &&
                faceDetails.z_axis
              )
            ) {
              return
            }
            const lastKey = path.slice(-1)[0][0]
            modificationDetails.push({
              parentPipe: parentPipe.node,
              parentInit: parentInit.node,
              faceDetails,
              lastKey,
            })
          }
          for (const {
            parentInit,
            parentPipe,
            faceDetails,
            lastKey,
          } of modificationDetails) {
            if (
              !(
                faceDetails.origin &&
                faceDetails.x_axis &&
                faceDetails.y_axis &&
                faceDetails.z_axis
              )
            ) {
              continue
            }
            const expression = createCallExpressionStdLibKw(
              'startSketchOn',
              createObjectExpression({
                origin: createObjectExpression({
                  x: roundLiteral(faceDetails.origin.x),
                  y: roundLiteral(faceDetails.origin.y),
                  z: roundLiteral(faceDetails.origin.z),
                }),
                xAxis: createObjectExpression({
                  x: roundLiteral(faceDetails.x_axis.x),
                  y: roundLiteral(faceDetails.x_axis.y),
                  z: roundLiteral(faceDetails.x_axis.z),
                }),
                yAxis: createObjectExpression({
                  x: roundLiteral(faceDetails.y_axis.x),
                  y: roundLiteral(faceDetails.y_axis.y),
                  z: roundLiteral(faceDetails.y_axis.z),
                }),
                zAxis: createObjectExpression({
                  x: roundLiteral(faceDetails.z_axis.x),
                  y: roundLiteral(faceDetails.z_axis.y),
                  z: roundLiteral(faceDetails.z_axis.z),
                }),
              }),
              []
            )
            if (
              parentInit.type === 'VariableDeclarator' &&
              lastKey === 'init'
            ) {
              parentInit[lastKey] = expression
            } else if (isArray(parentPipe) && typeof lastKey === 'number') {
              parentPipe[lastKey] = expression
            }
          }
          resolve(true)
        })().catch(reportRejection)
      })
    }
    // await prom
    return astClone
  } else if (selection.artifact?.type === 'edgeCut') {
    return deleteEdgeTreatment(astClone, selection)
  } else if (varDec.node.init.type === 'PipeExpression') {
    const pipeBody = varDec.node.init.body
    const doNotDeleteProfileIfItHasBeenExtruded = !(
      selection?.artifact?.type === 'segment' && selection?.artifact?.surfaceId
    )
    if (
      pipeBody[0].type === 'CallExpressionKw' &&
      doNotDeleteProfileIfItHasBeenExtruded &&
      (pipeBody[0].callee.name.name === 'startSketchOn' ||
        pipeBody[0].callee.name.name === 'startProfile')
    ) {
      // remove varDec
      const varDecIndex = varDec.shallowPath[1][0] as number
      astClone.body.splice(varDecIndex, 1)
      return astClone
    }
  } else if (
    // single expression profiles
    varDec.node.init.type === 'CallExpressionKw' &&
    ['circleThreePoint', 'circle'].includes(varDec.node.init.callee.name.name)
  ) {
    const varDecIndex = varDec.shallowPath[1][0] as number
    astClone.body.splice(varDecIndex, 1)
    return astClone
  }

  return new Error('Selection not recognised, could not delete')
}
