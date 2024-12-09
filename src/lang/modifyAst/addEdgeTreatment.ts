import {
  CallExpression,
  Expr,
  Identifier,
  ObjectExpression,
  PathToNode,
  Program,
  VariableDeclaration,
  VariableDeclarator,
  sketchFromKclValue,
} from '../wasm'
import {
  createCallExpressionStdLib,
  createPipeSubstitution,
  createObjectExpression,
  createArrayExpression,
  createIdentifier,
  createPipeExpression,
} from '../modifyAst'
import {
  getNodeFromPath,
  getNodePathFromSourceRange,
  hasSketchPipeBeenExtruded,
  traverse,
} from '../queryAst'
import {
  addTagForSketchOnFace,
  getTagFromCallExpression,
  sketchLineHelperMap,
} from '../std/sketch'
import { err, trap } from 'lib/trap'
import { Selections } from 'lib/selections'
import { KclCommandValue } from 'lib/commandTypes'
import {
  Artifact,
  ArtifactGraph,
  getSweepFromSuspectedPath,
} from 'lang/std/artifactGraph'
import {
  kclManager,
  engineCommandManager,
  editorManager,
  codeManager,
} from 'lib/singletons'
import { Node } from 'wasm-lib/kcl/bindings/Node'

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
export function applyEdgeTreatmentToSelection(
  ast: Node<Program>,
  selection: Selections,
  parameters: EdgeTreatmentParameters
): void | Error {
  // 1. clone and modify with edge treatment and tag
  const result = modifyAstWithEdgeTreatmentAndTag(ast, selection, parameters)
  if (err(result)) return result
  const { modifiedAst, pathToEdgeTreatmentNode } = result

  // 2. update ast
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  updateAstAndFocus(modifiedAst, pathToEdgeTreatmentNode)
}

export function modifyAstWithEdgeTreatmentAndTag(
  ast: Node<Program>,
  selections: Selections,
  parameters: EdgeTreatmentParameters
):
  | { modifiedAst: Node<Program>; pathToEdgeTreatmentNode: Array<PathToNode> }
  | Error {
  let clonedAst = structuredClone(ast)
  const clonedAstForGetExtrude = structuredClone(ast)

  const astResult = insertParametersIntoAst(clonedAst, parameters)
  if (err(astResult)) return astResult

  const artifactGraph = engineCommandManager.artifactGraph

  // Step 1: modify ast with tags and group them by extrude nodes (bodies)
  const extrudeToTagsMap: Map<
    PathToNode,
    Array<{ tag: string; artifact: Artifact }>
  > = new Map()
  const lookupMap: Map<string, PathToNode> = new Map() // work around for Map key comparison

  for (const selection of selections.graphSelections) {
    const singleSelection = {
      graphSelections: [selection],
      otherSelections: [],
    }

    const result = getPathToExtrudeForSegmentSelection(
      clonedAstForGetExtrude,
      singleSelection,
      artifactGraph
    )
    if (err(result)) return result
    const { pathToSegmentNode, pathToExtrudeNode } = result

    const tagResult = mutateAstWithTagForSketchSegment(
      clonedAst,
      pathToSegmentNode
    )
    if (err(tagResult)) return tagResult
    const { tag } = tagResult

    // Group tags by their corresponding extrude node
    const extrudeKey = JSON.stringify(pathToExtrudeNode)

    if (lookupMap.has(extrudeKey) && selection.artifact) {
      const existingPath = lookupMap.get(extrudeKey)
      if (!existingPath) return new Error('Path to extrude node not found.')
      extrudeToTagsMap
        .get(existingPath)
        ?.push({ tag, artifact: selection.artifact } as const)
    } else if (selection.artifact) {
      lookupMap.set(extrudeKey, pathToExtrudeNode)
      extrudeToTagsMap.set(pathToExtrudeNode, [
        { tag, artifact: selection.artifact } as const,
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
    const tagCalls = tagInfos.map(({ tag, artifact }) => {
      return getEdgeTagCall(tag, artifact)
    })
    const firstTag = tagCalls[0] // can be Identifier or CallExpression (for opposite and adjacent edges)

    // edge treatment call
    const edgeTreatmentCall = createCallExpressionStdLib(parameters.type, [
      createObjectExpression({
        [parameterName]: parameterValue,
        tags: createArrayExpression(tagCalls),
      }),
      createPipeSubstitution(),
    ])

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

    if (extrudeDeclarator.init.type === 'CallExpression') {
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
  selection: Selections,
  artifactGraph: ArtifactGraph
): { pathToSegmentNode: PathToNode; pathToExtrudeNode: PathToNode } | Error {
  const pathToSegmentNode = getNodePathFromSourceRange(
    ast,
    selection.graphSelections[0]?.codeRef?.range
  )

  const varDecNode = getNodeFromPath<VariableDeclaration>(
    ast,
    pathToSegmentNode,
    'VariableDeclaration'
  )
  if (err(varDecNode)) return varDecNode
  const sketchVar = varDecNode.node.declaration.id.name

  const sketch = sketchFromKclValue(
    kclManager.programMemory.get(sketchVar),
    sketchVar
  )
  if (trap(sketch)) return sketch

  const extrusion = getSweepFromSuspectedPath(sketch.id, artifactGraph)
  if (err(extrusion)) return extrusion

  const pathToExtrudeNode = getNodePathFromSourceRange(
    ast,
    extrusion.codeRef.range
  )
  if (err(pathToExtrudeNode)) return pathToExtrudeNode

  return { pathToSegmentNode, pathToExtrudeNode }
}

async function updateAstAndFocus(
  modifiedAst: Node<Program>,
  pathToEdgeTreatmentNode: Array<PathToNode>
) {
  const updatedAst = await kclManager.updateAst(modifiedAst, true, {
    focusPath: pathToEdgeTreatmentNode,
  })

  await codeManager.updateEditorWithAstAndWriteToFile(updatedAst.newAst)

  if (updatedAst?.selections) {
    editorManager.selectRange(updatedAst?.selections)
  }
}

export function mutateAstWithTagForSketchSegment(
  astClone: Node<Program>,
  pathToSegmentNode: PathToNode
): { modifiedAst: Program; tag: string } | Error {
  const segmentNode = getNodeFromPath<CallExpression>(
    astClone,
    pathToSegmentNode,
    'CallExpression'
  )
  if (err(segmentNode)) return segmentNode

  // Check whether selection is a valid segment
  if (!(segmentNode.node.callee.name in sketchLineHelperMap)) {
    return new Error('Selection is not a sketch segment')
  }

  // Add tag to the sketch segment or use existing tag
  // a helper function that creates the updated node and applies the changes to the AST
  const taggedSegment = addTagForSketchOnFace(
    {
      pathToNode: pathToSegmentNode,
      node: astClone,
    },
    segmentNode.node.callee.name,
    null
  )
  if (err(taggedSegment)) return taggedSegment
  const { tag } = taggedSegment

  return { modifiedAst: astClone, tag }
}

export function getEdgeTagCall(
  tag: string,
  artifact: Artifact
): Node<Identifier | CallExpression> {
  let tagCall: Expr = createIdentifier(tag)

  // Modify the tag based on selectionType
  if (artifact.type === 'sweepEdge' && artifact.subType === 'opposite') {
    tagCall = createCallExpressionStdLib('getOppositeEdge', [tagCall])
  } else if (artifact.type === 'sweepEdge' && artifact.subType === 'adjacent') {
    tagCall = createCallExpressionStdLib('getNextAdjacentEdge', [tagCall])
  }
  return tagCall
}

function locateExtrudeDeclarator(
  node: Program,
  pathToExtrudeNode: PathToNode
): { extrudeDeclarator: VariableDeclarator } | Error {
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
    extrudeInit.type !== 'CallExpression' &&
    extrudeInit.type !== 'PipeExpression'
  ) {
    return new Error('Extrude must be a PipeExpression or CallExpression')
  }

  return { extrudeDeclarator }
}

function getPathToNodeOfEdgeTreatmentLiteral(
  pathToExtrudeNode: PathToNode,
  extrudeDeclarator: VariableDeclarator,
  tag: Identifier | CallExpression,
  parameters: EdgeTreatmentParameters
): PathToNode {
  let pathToEdgeTreatmentObj: PathToNode = []
  let inEdgeTreatment = false

  traverse(extrudeDeclarator.init, {
    enter(node, path) {
      if (
        node.type === 'CallExpression' &&
        node.callee.name === parameters.type
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
        node.type === 'CallExpression' &&
        node.callee.name === parameters.type
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

function hasTag(
  node: ObjectExpression,
  tag: Identifier | CallExpression
): boolean {
  return node.properties.some((prop) => {
    if (prop.key.name === 'tags' && prop.value.type === 'ArrayExpression') {
      // if selection is a base edge:
      if (tag.type === 'Identifier') {
        return prop.value.elements.some(
          (element) =>
            element.type === 'Identifier' && element.name === tag.name
        )
      }
      // if selection is an adjacent or opposite edge:
      if (tag.type === 'CallExpression') {
        return prop.value.elements.some(
          (element) =>
            element.type === 'CallExpression' &&
            element.callee.name === tag.callee.name && // edge location
            element.arguments[0].type === 'Identifier' &&
            tag.arguments[0].type === 'Identifier' &&
            element.arguments[0].name === tag.arguments[0].name // tag name
        )
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
    return new Error('Unsupported edge treatment type}')
  }
}

// Type Guards
function isEdgeTreatmentType(name: string): name is EdgeTreatmentType {
  return name === EdgeTreatmentType.Chamfer || name === EdgeTreatmentType.Fillet
}
function isEdgeType(name: string): name is EdgeTypes {
  return (
    name === 'getNextAdjacentEdge' ||
    name === 'getPreviousAdjacentEdge' ||
    name === 'getOppositeEdge'
  )
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
        node.type === 'CallExpression' &&
        (node.callee.name === 'extrude' || node.callee.name === 'revolve')
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
    const segmentNode = getNodeFromPath<Node<CallExpression>>(
      ast,
      selection.codeRef.pathToNode,
      'CallExpression'
    )
    if (err(segmentNode)) return false
    if (segmentNode.node.type !== 'CallExpression') {
      return false
    }
    if (!(segmentNode.node.callee.name in sketchLineHelperMap)) {
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
            node.type === 'CallExpression' &&
            isEdgeTreatmentType(node.callee.name)
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
            node.type === 'CallExpression' &&
            isEdgeTreatmentType(node.callee.name)
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

type EdgeTypes =
  | 'baseEdge'
  | 'getNextAdjacentEdge'
  | 'getPreviousAdjacentEdge'
  | 'getOppositeEdge'

export const isTagUsedInEdgeTreatment = ({
  ast,
  callExp,
}: {
  ast: Node<Program>
  callExp: CallExpression
}): Array<EdgeTypes> => {
  const tag = getTagFromCallExpression(callExp)
  if (err(tag)) return []

  let inEdgeTreatment = false
  let inObj = false
  let inTagHelper: EdgeTypes | '' = ''
  const edges: Array<EdgeTypes> = []

  traverse(ast, {
    enter: (node) => {
      // Check if we are entering an edge treatment call
      if (
        node.type === 'CallExpression' &&
        isEdgeTreatmentType(node.callee.name)
      ) {
        inEdgeTreatment = true
      }
      if (inEdgeTreatment && node.type === 'ObjectExpression') {
        node.properties.forEach((prop) => {
          if (
            prop.key.name === 'tags' &&
            prop.value.type === 'ArrayExpression'
          ) {
            inObj = true
          }
        })
      }
      if (
        inObj &&
        inEdgeTreatment &&
        node.type === 'CallExpression' &&
        isEdgeType(node.callee.name)
      ) {
        inTagHelper = node.callee.name
      }
      if (
        inObj &&
        inEdgeTreatment &&
        !inTagHelper &&
        node.type === 'Identifier' &&
        node.name === tag
      ) {
        edges.push('baseEdge')
      }
      if (
        inObj &&
        inEdgeTreatment &&
        inTagHelper &&
        node.type === 'Identifier' &&
        node.name === tag
      ) {
        edges.push(inTagHelper)
      }
    },
    leave: (node) => {
      if (
        node.type === 'CallExpression' &&
        isEdgeTreatmentType(node.callee.name)
      ) {
        inEdgeTreatment = false
      }
      if (inEdgeTreatment && node.type === 'ObjectExpression') {
        node.properties.forEach((prop) => {
          if (
            prop.key.name === 'tags' &&
            prop.value.type === 'ArrayExpression'
          ) {
            inObj = true
          }
        })
      }
      if (
        inObj &&
        inEdgeTreatment &&
        node.type === 'CallExpression' &&
        isEdgeType(node.callee.name)
      ) {
        inTagHelper = ''
      }
    },
  })

  return edges
}
