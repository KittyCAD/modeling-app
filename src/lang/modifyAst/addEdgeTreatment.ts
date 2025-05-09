import type { Name } from '@rust/kcl-lib/bindings/Name'
import type { Node } from '@rust/kcl-lib/bindings/Node'

import type EditorManager from '@src/editor/manager'
import type { KclManager } from '@src/lang/KclSingleton'
import type CodeManager from '@src/lang/codeManager'
import { ARG_TAG } from '@src/lang/constants'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
  createPipeExpression,
} from '@src/lang/create'
import {
  getNodeFromPath,
  hasSketchPipeBeenExtruded,
  traverse,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact } from '@src/lang/std/artifactGraph'
import { getSweepArtifactFromSelection } from '@src/lang/std/artifactGraph'
import type { EngineCommandManager } from '@src/lang/std/engineConnection'
import {
  addTagForSketchOnFace,
  sketchLineHelperMapKw,
} from '@src/lang/std/sketch'
import { findKwArg } from '@src/lang/util'
import {
  type ArtifactGraph,
  type CallExpressionKw,
  type Expr,
  type ObjectExpression,
  type PathToNode,
  type Program,
  type VariableDeclaration,
  type VariableDeclarator,
  type ExpressionStatement,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { Selection, Selections } from '@src/lib/selections'
import { err } from '@src/lib/trap'
import {
  createTagExpressions,
  modifyAstWithTagsForSelection,
} from '@src/lang/modifyAst/tagManagement'
import { deleteNodeInExtrudePipe } from '@src/lang/modifyAst/deleteNodeInExtrudePipe'
import { deleteTopLevelStatement } from '@src/lang/modifyAst'

// Edge Treatment Types
export enum EdgeTreatmentType {
  Chamfer = 'chamfer',
  Fillet = 'fillet',
}

export interface ChamferParameters {
  type: EdgeTreatmentType.Chamfer
  length: KclCommandValue
}
export interface FilletParameters {
  type: EdgeTreatmentType.Fillet
  radius: KclCommandValue
}
export type EdgeTreatmentParameters = ChamferParameters | FilletParameters

// Apply Edge Treatment (Fillet or Chamfer) To Selection
export async function modifyAstWithEdgeTreatmentAndTag(
  ast: Node<Program>,
  selections: Selections,
  parameters: EdgeTreatmentParameters,
  dependencies: {
    kclManager: KclManager
    engineCommandManager: EngineCommandManager
    editorManager: EditorManager
    codeManager: CodeManager
  }
): Promise<
  { modifiedAst: Node<Program>; pathToEdgeTreatmentNode: PathToNode[] } | Error
> {
  let clonedAst = structuredClone(ast)
  const clonedAstForGetExtrude = structuredClone(ast)

  const astResult = insertParametersIntoAst(clonedAst, parameters)
  if (err(astResult)) return astResult

  const artifactGraph = dependencies.kclManager.artifactGraph

  // Step 1: modify ast with tags and group them by extrude nodes (bodies)
  const extrudeToTagsMap: Map<
    PathToNode,
    Array<{ tags: string[]; artifact: Artifact }>
  > = new Map()
  const lookupMap: Map<string, PathToNode> = new Map() // work around for Map key comparison

  for (const selection of selections.graphSelections) {
    const result = getPathToExtrudeForSegmentSelection(
      clonedAstForGetExtrude,
      selection,
      artifactGraph
    )
    if (err(result)) return result
    const { pathToExtrudeNode } = result

    const tags: Array<string> = []

    const tagResult = modifyAstWithTagsForSelection(
      clonedAst,
      selection,
      artifactGraph
    )

    if (err(tagResult)) return tagResult

    clonedAst = tagResult.modifiedAst
    tags.push(...tagResult.tags)

    // Group tags by their corresponding extrude node
    const extrudeKey = JSON.stringify(pathToExtrudeNode)

    if (lookupMap.has(extrudeKey) && selection.artifact) {
      const existingPath = lookupMap.get(extrudeKey)
      if (!existingPath) return new Error('Path to extrude node not found.')
      extrudeToTagsMap
        .get(existingPath)
        ?.push({ tags, artifact: selection.artifact } as const)
    } else if (selection.artifact) {
      lookupMap.set(extrudeKey, pathToExtrudeNode)
      extrudeToTagsMap.set(pathToExtrudeNode, [
        { tags, artifact: selection.artifact } as const,
      ])
    }
  }

  // Step 2: Apply edge treatments for each extrude node (body)
  let pathToEdgeTreatmentNodes: Array<PathToNode> = []
  for (const [pathToExtrudeNode, tagInfos] of extrudeToTagsMap.entries()) {
    // Create an edge treatment expression with multiple tags

    // edge treatment parameter
    const parameterResult = getParameterNameAndValue(parameters)
    if (err(parameterResult)) return parameterResult
    const { parameterName, parameterValue } = parameterResult

    // tag calls
    const tagCalls = tagInfos.map(({ tags, artifact }) => {
      return createCallExpressionStdLibKw('getCommonEdge', null, [
        createLabeledArg(
          'faces',
          createArrayExpression(tags.map((tag) => createLocalName(tag)))
        ),
      ])
    })
    const firstTag = tagCalls[0] // can be Identifier or CallExpression (for opposite and adjacent edges)

    const tagExpressions = createTagExpressions(tagInfos)

    // edge treatment call
    const edgeTreatmentCall = createCallExpressionStdLibKw(
      parameters.type,
      null,
      [
        createLabeledArg(parameterName, parameterValue),
        createLabeledArg('tags', createArrayExpression(tagExpressions)),
      ]
    )

    // Locate the extrude call
    const locatedExtrudeDeclarator = locateExtrudeDeclarator(
      clonedAst,
      pathToExtrudeNode
    )
    if (err(locatedExtrudeDeclarator)) return locatedExtrudeDeclarator
    const { extrudeDeclarator } = locatedExtrudeDeclarator

    // Modify the extrude expression to include this edge treatment expression
    // CallExpression - no edge treatment
    // PipeExpression - edge treatment exists or body in sketch pipe

    let pathToEdgeTreatmentNode: PathToNode

    if (extrudeDeclarator.init.type === 'CallExpressionKw') {
      // 1. case when no edge treatment exists

      // modify ast with new edge treatment call by mutating the extrude node
      extrudeDeclarator.init = createPipeExpression([
        extrudeDeclarator.init,
        edgeTreatmentCall,
      ])

      // get path to the edge treatment node
      pathToEdgeTreatmentNode = getPathToNodeOfEdgeTreatmentLiteral(
        pathToExtrudeNode,
        extrudeDeclarator,
        firstTag,
        parameters
      )
      pathToEdgeTreatmentNodes.push(pathToEdgeTreatmentNode)
    } else if (extrudeDeclarator.init.type === 'PipeExpression') {
      // 2. case when edge treatment exists or extrude in sketch pipe

      // mutate the extrude node with the new edge treatment call
      extrudeDeclarator.init.body.push(edgeTreatmentCall)

      // get path to the edge treatment node
      pathToEdgeTreatmentNode = getPathToNodeOfEdgeTreatmentLiteral(
        pathToExtrudeNode,
        extrudeDeclarator,
        firstTag,
        parameters
      )
      pathToEdgeTreatmentNodes.push(pathToEdgeTreatmentNode)
    } else {
      return new Error('Unsupported extrude type.')
    }
  }
  return {
    modifiedAst: clonedAst,
    pathToEdgeTreatmentNode: pathToEdgeTreatmentNodes,
  }
}

function insertParametersIntoAst(
  ast: Program,
  parameters: EdgeTreatmentParameters
): { ast: Program } | Error {
  try {
    const newAst = structuredClone(ast)

    // handle radius parameter
    if (
      parameters.type === EdgeTreatmentType.Fillet &&
      'variableName' in parameters.radius &&
      parameters.radius.variableName &&
      parameters.radius.insertIndex !== undefined
    ) {
      newAst.body.splice(
        parameters.radius.insertIndex,
        0,
        parameters.radius.variableDeclarationAst
      )
    }
    // handle length parameter
    if (
      parameters.type === EdgeTreatmentType.Chamfer &&
      'variableName' in parameters.length &&
      parameters.length.variableName &&
      parameters.length.insertIndex !== undefined
    ) {
      newAst.body.splice(
        parameters.length.insertIndex,
        0,
        parameters.length.variableDeclarationAst
      )
    }

    // handle upcoming parameters here (for blend, bevel, etc.)
    return { ast: newAst }
  } catch (error) {
    return new Error(`Failed to handle AST: ${(error as Error).message}`)
  }
}

export function getPathToExtrudeForSegmentSelection(
  ast: Program,
  selection: Selection,
  artifactGraph: ArtifactGraph
): { pathToSegmentNode: PathToNode; pathToExtrudeNode: PathToNode } | Error {
  const pathToSegmentNode = getNodePathFromSourceRange(
    ast,
    selection.codeRef?.range
  )
  const sweepArtifact = getSweepArtifactFromSelection(selection, artifactGraph)
  if (err(sweepArtifact)) return sweepArtifact

  const pathToExtrudeNode = getNodePathFromSourceRange(
    ast,
    sweepArtifact.codeRef.range
  )
  if (err(pathToExtrudeNode)) return pathToExtrudeNode

  return { pathToSegmentNode, pathToExtrudeNode }
}

export function mutateAstWithTagForSketchSegment(
  astClone: Node<Program>,
  pathToSegmentNode: PathToNode
): { modifiedAst: Node<Program>; tag: string } | Error {
  const segmentNode = getNodeFromPath<CallExpressionKw>(
    astClone,
    pathToSegmentNode,
    ['CallExpressionKw']
  )
  if (err(segmentNode)) return segmentNode

  // Check whether selection is a valid segment
  if (
    !segmentNode.node.callee ||
    !(segmentNode.node.callee.name.name in sketchLineHelperMapKw)
  ) {
    return new Error('Selection is not a sketch segment')
  }

  // Add tag to the sketch segment or use existing tag
  // a helper function that creates the updated node and applies the changes to the AST
  const taggedSegment = addTagForSketchOnFace(
    {
      pathToNode: pathToSegmentNode,
      node: astClone,
    },
    segmentNode.node.callee.name.name,
    null
  )
  if (err(taggedSegment)) return taggedSegment
  const { tag } = taggedSegment

  return { modifiedAst: astClone, tag }
}

export function getEdgeTagCall(
  tag: string,
  artifact: Artifact
): Node<Name | CallExpressionKw> {
  let tagCall: Expr = createLocalName(tag)

  // Modify the tag based on selectionType
  if (artifact.type === 'sweepEdge' && artifact.subType === 'opposite') {
    tagCall = createCallExpressionStdLibKw('getOppositeEdge', tagCall, [])
  } else if (artifact.type === 'sweepEdge' && artifact.subType === 'adjacent') {
    tagCall = createCallExpressionStdLibKw('getNextAdjacentEdge', tagCall, [])
  }
  return tagCall
}

export function locateExtrudeDeclarator(
  node: Program,
  pathToExtrudeNode: PathToNode
): { extrudeDeclarator: VariableDeclarator; shallowPath: PathToNode } | Error {
  const nodeOfExtrudeCall = getNodeFromPath<VariableDeclaration>(
    node,
    pathToExtrudeNode,
    'VariableDeclaration'
  )
  if (err(nodeOfExtrudeCall)) return nodeOfExtrudeCall

  const { node: extrudeVarDecl } = nodeOfExtrudeCall
  const extrudeDeclarator = extrudeVarDecl.declaration
  if (!extrudeDeclarator) {
    return new Error('Extrude Declarator not found.')
  }

  const extrudeInit = extrudeDeclarator?.init
  if (!extrudeInit) {
    return new Error('Extrude Init not found.')
  }

  if (
    extrudeInit.type !== 'CallExpressionKw' &&
    extrudeInit.type !== 'PipeExpression'
  ) {
    return new Error('Extrude must be a PipeExpression or CallExpressionKw')
  }

  return { extrudeDeclarator, shallowPath: nodeOfExtrudeCall.shallowPath }
}

function getPathToNodeOfEdgeTreatmentLiteral(
  pathToExtrudeNode: PathToNode,
  extrudeDeclarator: VariableDeclarator,
  tag: Name | CallExpressionKw,
  parameters: EdgeTreatmentParameters
): PathToNode {
  let pathToEdgeTreatmentObj: PathToNode = []
  let inEdgeTreatment = false

  traverse(extrudeDeclarator.init, {
    enter(node, path) {
      if (
        node.type === 'CallExpressionKw' &&
        node.callee.name.name === parameters.type
      ) {
        inEdgeTreatment = true
      }
      if (inEdgeTreatment && node.type === 'ObjectExpression') {
        if (!hasTag(node, tag)) return false
        pathToEdgeTreatmentObj = getPathToEdgeTreatmentParameterLiteral(
          node,
          path,
          parameters
        )
      }
    },
    leave(node) {
      if (
        node.type === 'CallExpressionKw' &&
        node.callee.name.name === parameters.type
      ) {
        inEdgeTreatment = false
      }
    },
  })
  let indexOfPipeExpression = pathToExtrudeNode.findIndex(
    (path) => path[1] === 'PipeExpression'
  )

  indexOfPipeExpression =
    indexOfPipeExpression === -1
      ? pathToExtrudeNode.length
      : indexOfPipeExpression

  return [
    ...pathToExtrudeNode.slice(0, indexOfPipeExpression),
    ...pathToEdgeTreatmentObj,
  ]
}

function hasTag(node: ObjectExpression, tag: Name | CallExpressionKw): boolean {
  return node.properties.some((prop) => {
    if (prop.key.name === 'tags' && prop.value.type === 'ArrayExpression') {
      // if selection is a base edge:
      if (tag.type === 'Name') {
        return prop.value.elements.some(
          (element) =>
            element.type === 'Name' && element.name.name === tag.name.name
        )
      }
      if (tag.type === 'CallExpressionKw') {
        return prop.value.elements.some((element) => {
          if (element.type !== 'CallExpressionKw') {
            return false
          }

          const elementTag = findKwArg(ARG_TAG, element)
          const tagTag = findKwArg(ARG_TAG, tag)

          return (
            element.callee.name.name === tag.callee.name.name && // edge location
            elementTag !== undefined &&
            elementTag.type === 'Name' &&
            tagTag !== undefined &&
            tagTag.type === 'Name' &&
            elementTag.name.name === tagTag.name.name // tag name
          )
        })
      }
    }
    return false
  })
}

function getPathToEdgeTreatmentParameterLiteral(
  node: ObjectExpression,
  path: any,
  parameters: EdgeTreatmentParameters
): PathToNode {
  let pathToEdgeTreatmentObj = path
  const parameterResult = getParameterNameAndValue(parameters)
  if (err(parameterResult)) return pathToEdgeTreatmentObj
  const { parameterName } = parameterResult

  node.properties.forEach((prop, index) => {
    if (prop.key.name === parameterName) {
      pathToEdgeTreatmentObj.push(
        ['properties', 'ObjectExpression'],
        [index, 'index'],
        ['value', 'Property']
      )
    }
  })
  return pathToEdgeTreatmentObj
}

function getParameterNameAndValue(
  parameters: EdgeTreatmentParameters
): { parameterName: string; parameterValue: Expr } | Error {
  if (parameters.type === EdgeTreatmentType.Fillet) {
    const parameterValue =
      'variableName' in parameters.radius
        ? parameters.radius.variableIdentifierAst
        : parameters.radius.valueAst
    return { parameterName: 'radius', parameterValue }
  } else if (parameters.type === EdgeTreatmentType.Chamfer) {
    const parameterValue =
      'variableName' in parameters.length
        ? parameters.length.variableIdentifierAst
        : parameters.length.valueAst
    return { parameterName: 'length', parameterValue }
  } else {
    return new Error('Unsupported edge treatment type')
  }
}

// Type Guards
function isEdgeTreatmentType(name: string): name is EdgeTreatmentType {
  return name === EdgeTreatmentType.Chamfer || name === EdgeTreatmentType.Fillet
}

// Button states
export const hasValidEdgeTreatmentSelection = ({
  selectionRanges,
  ast,
  code,
}: {
  selectionRanges: Selections
  ast: Node<Program>
  code: string
}) => {
  // check if there is anything valid for the edge treatment in the scene
  let extrudeExists = false
  traverse(ast, {
    enter(node) {
      if (
        node.type == 'CallExpressionKw' &&
        (node.callee.name.name === 'extrude' ||
          node.callee.name.name === 'revolve')
      ) {
        extrudeExists = true
      }
    },
  })
  if (!extrudeExists) return false

  // check if nothing is selected
  if (selectionRanges.graphSelections.length === 0) {
    return true
  }

  // check if selection is last string in code
  if (selectionRanges.graphSelections[0]?.codeRef?.range[0] === code.length) {
    return true
  }

  // selection exists:
  for (const selection of selectionRanges.graphSelections) {
    // check if all selections are in sketchLineHelperMap
    const segmentNode = getNodeFromPath<Node<CallExpressionKw>>(
      ast,
      selection.codeRef.pathToNode,
      ['CallExpressionKw']
    )
    if (err(segmentNode)) return false
    if (!(segmentNode.node.type === 'CallExpressionKw')) {
      return false
    }
    if (!(segmentNode.node.callee.name.name in sketchLineHelperMapKw)) {
      return false
    }

    // check if selection is extruded
    // TODO: option 1 : extrude is in the sketch pipe

    // option 2: extrude is outside the sketch pipe
    const extrudeExists = hasSketchPipeBeenExtruded(selection, ast)
    if (err(extrudeExists)) {
      return false
    }
    if (!extrudeExists) {
      return false
    }

    // check if tag exists for the selection
    let tagExists = false
    let tag = ''
    traverse(segmentNode.node, {
      enter(node) {
        if (node.type === 'TagDeclarator') {
          tagExists = true
          tag = node.value
        }
      },
    })

    // check if tag is used in edge treatment
    if (tagExists && selection.artifact) {
      // create tag call
      let tagCall: Expr = getEdgeTagCall(tag, selection.artifact)

      // check if tag is used in edge treatment
      let inEdgeTreatment = false
      let tagUsedInEdgeTreatment = false

      traverse(ast, {
        enter(node) {
          if (
            node.type === 'CallExpressionKw' &&
            isEdgeTreatmentType(node.callee.name.name)
          ) {
            inEdgeTreatment = true
          }
          if (inEdgeTreatment && node.type === 'ObjectExpression') {
            if (hasTag(node, tagCall)) {
              tagUsedInEdgeTreatment = true
            }
          }
        },
        leave(node) {
          if (
            node.type === 'CallExpressionKw' &&
            isEdgeTreatmentType(node.callee.name.name)
          ) {
            inEdgeTreatment = false
          }
        },
      })
      if (tagUsedInEdgeTreatment) {
        return false
      }
    }
  }
  return true
}

// Delete Edge Treatment
export async function deleteEdgeTreatment(
  ast: Node<Program>,
  selection: Selection
): Promise<Node<Program> | Error> {
  /**
   * Deletes an edge treatment (fillet or chamfer) from the AST 
   *
   * Supported cases:
   * [+] fillet and chamfer
   * [+] piped, standalone (assigned and unassigned) edge treatments
   * [-] delete single tag from array of tags (currently whole expression is deleted)
   * [-] multiple selections with different edge treatments (currently single selection is supported)
   */

  // 1. Validate Selection Type
  const { artifact } = selection
  if (!artifact || artifact.type !== 'edgeCut') {
    return new Error('Selection is not an edge cut')
  }

  const { subType } = artifact
  if (!isEdgeTreatmentType(subType)) {
    return new Error('Unsupported or missing edge treatment type')
  }

  // 2. Clone ast and retrieve the edge treatment node
  const astClone = structuredClone(ast)
  const edgeTreatmentNode = getNodeFromPath<
    VariableDeclarator | ExpressionStatement
  >(astClone, selection?.codeRef?.pathToNode, [
    'VariableDeclarator',
    'ExpressionStatement',
  ])
  if (err(edgeTreatmentNode)) return edgeTreatmentNode

  // 3: Delete edge treatments
  // There 3 possible cases:
  // - piped: const body = extrude(...) |> fillet(...)
  // - assigned to variables: fillet0001 = fillet(...)
  // - unassigned standalone statements: fillet(...)
  // piped and assigned nodes are in the variable declarator
  // unassigned nodes are in the expression statement

  if (
    edgeTreatmentNode.node.type === 'ExpressionStatement' || // unassigned
    (edgeTreatmentNode.node.type === 'VariableDeclarator' && // assigned
      edgeTreatmentNode.node.init?.type !== 'PipeExpression')
  ) {
    // Handle both standalone cases (assigned and unassigned)
    const deleteResult = deleteTopLevelStatement(
      astClone,
      selection.codeRef.pathToNode
    )
    if (err(deleteResult)) return deleteResult
    return astClone
  } else {
    const deleteResult = deleteNodeInExtrudePipe(
      astClone,
      selection.codeRef.pathToNode
    )
    if (err(deleteResult)) return deleteResult
    return astClone
  }
}

// Edit Edge Treatment
export async function editEdgeTreatment(
  ast: Node<Program>,
  selection: Selection,
  parameters: EdgeTreatmentParameters
): Promise<
  { modifiedAst: Node<Program>; pathToEdgeTreatmentNode: PathToNode } | Error
> {
  // 1. clone and modify with new value
  const modifiedAst = structuredClone(ast)

  // find the edge treatment call
  const edgeTreatmentCall = getNodeFromPath<CallExpressionKw>(
    modifiedAst,
    selection?.codeRef?.pathToNode,
    'CallExpressionKw'
  )
  if (err(edgeTreatmentCall)) return edgeTreatmentCall

  // edge treatment parameter
  const parameterResult = getParameterNameAndValue(parameters)
  if (err(parameterResult)) return parameterResult
  const { parameterName, parameterValue } = parameterResult

  // find the index of an argument to update
  const index = edgeTreatmentCall.node.arguments.findIndex(
    (arg) => arg.label?.name === parameterName
  )

  // create a new argument with the updated value
  const newArg = createLabeledArg(parameterName, parameterValue)

  // if the parameter doesn't exist, add it; otherwise replace it
  if (index === -1) {
    edgeTreatmentCall.node.arguments.push(newArg)
  } else {
    edgeTreatmentCall.node.arguments[index] = newArg
  }

  const pathToEdgeTreatmentNode = selection?.codeRef?.pathToNode

  return { modifiedAst, pathToEdgeTreatmentNode }
}
