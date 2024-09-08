import {
  ArrayExpression,
  CallExpression,
  ObjectExpression,
  PathToNode,
  Program,
  ProgramMemory,
  Expr,
  VariableDeclaration,
  VariableDeclarator,
  sketchGroupFromKclValue,
} from '../wasm'
import {
  createCallExpressionStdLib,
  createLiteral,
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
import { Selections__old, canFilletSelection } from 'lib/selections'
import { KclCommandValue } from 'lib/commandTypes'
import {
  ArtifactGraph,
  getSweepFromSuspectedPath,
} from 'lang/std/artifactGraph'
import { kclManager, engineCommandManager, editorManager } from 'lib/singletons'

/**
 * Apply Fillet To Selection
 */

export function applyFilletToSelection(
  ast: Program,
  selection: Selections__old,
  radius: KclCommandValue
): void | Error {
  // 1. clone ast
  let clonedAst = structuredClone(ast)

  // 2. modify ast clone with fillet and tag
  const result = modifyAstWithFilletAndTag(clonedAst, selection, radius)
  if (err(result)) return result
  const { modifiedAst, pathToFilletNode } = result

  // 3. update ast
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  updateAstAndFocus(modifiedAst, pathToFilletNode)
}

export function modifyAstWithFilletAndTag(
  ast: Program,
  selection: Selections__old,
  radius: KclCommandValue
): { modifiedAst: Program; pathToFilletNode: Array<PathToNode> } | Error {
  const astResult = insertRadiusIntoAst(ast, radius)
  if (err(astResult)) return astResult

  const programMemory = kclManager.programMemory
  const artifactGraph = engineCommandManager.artifactGraph

  let clonedAst = structuredClone(ast)
  const clonedAstForGetExtrude = structuredClone(ast)
  let pathToFilletNodes: Array<PathToNode> = []

  for (const selectionRange of selection.codeBasedSelections) {
    const singleSelection = {
      codeBasedSelections: [selectionRange],
      otherSelections: [],
    }
    const getPathToExtrudeForSegmentSelectionResult =
      getPathToExtrudeForSegmentSelection(
        clonedAstForGetExtrude,
        singleSelection,
        programMemory,
        artifactGraph
      )
    if (err(getPathToExtrudeForSegmentSelectionResult))
      return getPathToExtrudeForSegmentSelectionResult
    const { pathToSegmentNode, pathToExtrudeNode } =
      getPathToExtrudeForSegmentSelectionResult

    const addFilletResult = addFillet(
      clonedAst,
      pathToSegmentNode,
      pathToExtrudeNode,
      'variableName' in radius ? radius.variableIdentifierAst : radius.valueAst
    )
    if (trap(addFilletResult)) return addFilletResult
    const { modifiedAst, pathToFilletNode } = addFilletResult
    clonedAst = modifiedAst
    pathToFilletNodes.push(pathToFilletNode)
  }
  return { modifiedAst: clonedAst, pathToFilletNode: pathToFilletNodes }
}

function insertRadiusIntoAst(
  ast: Program,
  radius: KclCommandValue
): { ast: Program } | Error {
  try {
    // Validate and update AST
    if (
      'variableName' in radius &&
      radius.variableName &&
      radius.insertIndex !== undefined
    ) {
      const newAst = structuredClone(ast)
      newAst.body.splice(radius.insertIndex, 0, radius.variableDeclarationAst)
      return { ast: newAst }
    }
    return { ast }
  } catch (error) {
    return new Error(`Failed to handle AST: ${(error as Error).message}`)
  }
}

export function getPathToExtrudeForSegmentSelection(
  ast: Program,
  selection: Selections__old,
  programMemory: ProgramMemory,
  artifactGraph: ArtifactGraph
): { pathToSegmentNode: PathToNode; pathToExtrudeNode: PathToNode } | Error {
  const pathToSegmentNode = getNodePathFromSourceRange(
    ast,
    selection.codeBasedSelections[0].range
  )

  const varDecNode = getNodeFromPath<VariableDeclaration>(
    ast,
    pathToSegmentNode,
    'VariableDeclaration'
  )
  if (err(varDecNode)) return varDecNode
  const sketchVar = varDecNode.node.declarations[0].id.name

  const sketchGroup = sketchGroupFromKclValue(
    kclManager.programMemory.get(sketchVar),
    sketchVar
  )
  if (trap(sketchGroup)) return sketchGroup

  const extrusion = getSweepFromSuspectedPath(sketchGroup.id, artifactGraph)
  if (err(extrusion)) return extrusion

  const pathToExtrudeNode = getNodePathFromSourceRange(
    ast,
    extrusion.codeRef.range
  )
  if (err(pathToExtrudeNode)) return pathToExtrudeNode

  return { pathToSegmentNode, pathToExtrudeNode }
}

async function updateAstAndFocus(
  modifiedAst: Program,
  pathToFilletNode: Array<PathToNode>
) {
  const updatedAst = await kclManager.updateAst(modifiedAst, true, {
    focusPath: pathToFilletNode,
  })
  if (updatedAst?.selections) {
    editorManager.selectRange(updatedAst?.selections)
  }
}

/**
 * Add Fillet
 */

export function addFillet(
  ast: Program,
  pathToSegmentNode: PathToNode,
  pathToExtrudeNode: PathToNode,
  radius: Expr = createLiteral(5)
): { modifiedAst: Program; pathToFilletNode: PathToNode } | Error {
  // Clone AST to ensure safe mutations
  const astClone = structuredClone(ast)

  // Modify AST clone : TAG the sketch segment and retrieve tag
  const segmentResult = mutateAstWithTagForSketchSegment(
    astClone,
    pathToSegmentNode
  )
  if (err(segmentResult)) return segmentResult
  const { tag } = segmentResult

  // Modify AST clone : Insert FILLET node and retrieve path to fillet
  const filletResult = mutateAstWithFilletNode(
    astClone,
    pathToExtrudeNode,
    radius,
    tag
  )
  if (err(filletResult)) return filletResult
  const { pathToFilletNode } = filletResult

  return { modifiedAst: astClone, pathToFilletNode }
}

function mutateAstWithTagForSketchSegment(
  astClone: Program,
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
    segmentNode.node.callee.name
  )
  if (err(taggedSegment)) return taggedSegment
  const { tag } = taggedSegment

  return { modifiedAst: astClone, tag }
}

function mutateAstWithFilletNode(
  astClone: Program,
  pathToExtrudeNode: PathToNode,
  radius: Expr,
  tag: string
): { modifiedAst: Program; pathToFilletNode: PathToNode } | Error {
  // Locate the extrude call
  const locatedExtrudeDeclarator = locateExtrudeDeclarator(
    astClone,
    pathToExtrudeNode
  )
  if (err(locatedExtrudeDeclarator)) return locatedExtrudeDeclarator
  const { extrudeDeclarator } = locatedExtrudeDeclarator

  /**
   * Prepare changes to the AST
   */

  const filletCall = createCallExpressionStdLib('fillet', [
    createObjectExpression({
      radius: radius,
      tags: createArrayExpression([createIdentifier(tag)]),
    }),
    createPipeSubstitution(),
  ])

  /**
   * Mutate the AST
   */

  // CallExpression - no fillet
  // PipeExpression - fillet exists

  let pathToFilletNode: PathToNode = []

  if (extrudeDeclarator.init.type === 'CallExpression') {
    // 1. case when no fillet exists

    // modify ast with new fillet call by mutating the extrude node
    extrudeDeclarator.init = createPipeExpression([
      extrudeDeclarator.init,
      filletCall,
    ])

    // get path to the fillet node
    pathToFilletNode = getPathToNodeOfFilletLiteral(
      pathToExtrudeNode,
      extrudeDeclarator,
      tag
    )

    return { modifiedAst: astClone, pathToFilletNode }
  } else if (extrudeDeclarator.init.type === 'PipeExpression') {
    // 2. case when fillet exists

    const existingFilletCall = extrudeDeclarator.init.body.find((node) => {
      return node.type === 'CallExpression' && node.callee.name === 'fillet'
    })

    if (!existingFilletCall || existingFilletCall.type !== 'CallExpression') {
      return new Error('Fillet CallExpression not found.')
    }

    // check if the existing fillet has the same tag as the new fillet
    const filletTag = getFilletTag(existingFilletCall)

    if (filletTag !== tag) {
      // mutate the extrude node with the new fillet call
      extrudeDeclarator.init.body.push(filletCall)
      return {
        modifiedAst: astClone,
        pathToFilletNode: getPathToNodeOfFilletLiteral(
          pathToExtrudeNode,
          extrudeDeclarator,
          tag
        ),
      }
    }
  } else {
    return new Error('Unsupported extrude type.')
  }

  return { modifiedAst: astClone, pathToFilletNode }
}

function locateExtrudeDeclarator(
  node: Program,
  pathToExtrudeNode: PathToNode
): { extrudeDeclarator: VariableDeclarator } | Error {
  const extrudeChunk = getNodeFromPath<VariableDeclaration>(
    node,
    pathToExtrudeNode,
    'VariableDeclaration'
  )
  if (err(extrudeChunk)) return extrudeChunk

  const { node: extrudeVarDecl } = extrudeChunk
  const extrudeDeclarator = extrudeVarDecl.declarations[0]
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

function getPathToNodeOfFilletLiteral(
  pathToExtrudeNode: PathToNode,
  extrudeDeclarator: VariableDeclarator,
  tag: string
): PathToNode {
  let pathToFilletObj: PathToNode = []
  let inFillet = false

  traverse(extrudeDeclarator.init, {
    enter(node, path) {
      if (node.type === 'CallExpression' && node.callee.name === 'fillet') {
        inFillet = true
      }
      if (inFillet && node.type === 'ObjectExpression') {
        if (!hasTag(node, tag)) return false
        pathToFilletObj = getPathToRadiusLiteral(node, path)
      }
    },
    leave(node) {
      if (node.type === 'CallExpression' && node.callee.name === 'fillet') {
        inFillet = false
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
    ...pathToFilletObj,
  ]
}

function hasTag(node: ObjectExpression, tag: string): boolean {
  return node.properties.some((prop) => {
    if (prop.key.name === 'tags' && prop.value.type === 'ArrayExpression') {
      return prop.value.elements.some(
        (element) => element.type === 'Identifier' && element.name === tag
      )
    }
    return false
  })
}

function getPathToRadiusLiteral(node: ObjectExpression, path: any): PathToNode {
  let pathToFilletObj = path
  node.properties.forEach((prop, index) => {
    if (prop.key.name === 'radius') {
      pathToFilletObj.push(
        ['properties', 'ObjectExpression'],
        [index, 'index'],
        ['value', 'Property']
      )
    }
  })
  return pathToFilletObj
}

function getFilletTag(existingFilletCall: CallExpression): string | null {
  if (existingFilletCall.arguments[0].type === 'ObjectExpression') {
    const properties = (existingFilletCall.arguments[0] as ObjectExpression)
      .properties
    const tagsProperty = properties.find((prop) => prop.key.name === 'tags')
    if (tagsProperty && tagsProperty.value.type === 'ArrayExpression') {
      const elements = (tagsProperty.value as ArrayExpression).elements
      if (elements.length > 0 && elements[0].type === 'Identifier') {
        return elements[0].name
      }
    }
  }
  return null
}

/**
 * Button states
 */

export const hasValidFilletSelection = ({
  selectionRanges,
  ast,
  code,
}: {
  selectionRanges: Selections__old
  ast: Program
  code: string
}) => {
  // case 0: check if there is anything filletable in the scene
  let extrudeExists = false
  traverse(ast, {
    enter(node) {
      if (node.type === 'CallExpression' && node.callee.name === 'extrude') {
        extrudeExists = true
      }
    },
  })
  if (!extrudeExists) return false

  // case 1: nothing selected, test whether the extrusion exists
  if (selectionRanges) {
    if (selectionRanges.codeBasedSelections.length === 0) {
      return true
    }
    const range0 = selectionRanges.codeBasedSelections[0].range[0]
    const codeLength = code.length
    if (range0 === codeLength) {
      return true
    }
  }

  // case 2: sketch segment selected, test whether it is extruded
  // TODO: add loft / sweep check
  if (selectionRanges.codeBasedSelections.length > 0) {
    const isExtruded = hasSketchPipeBeenExtruded(
      selectionRanges.codeBasedSelections[0],
      ast
    )
    if (isExtruded) {
      const pathToSelectedNode = getNodePathFromSourceRange(
        ast,
        selectionRanges.codeBasedSelections[0].range
      )
      const segmentNode = getNodeFromPath<CallExpression>(
        ast,
        pathToSelectedNode,
        'CallExpression'
      )
      if (err(segmentNode)) return false
      if (segmentNode.node.type === 'CallExpression') {
        const segmentName = segmentNode.node.callee.name
        if (segmentName in sketchLineHelperMap) {
          // Add check whether the tag exists at all:
          if (!(segmentNode.node.arguments.length === 3)) return true
          // If the tag exists, check if it is already filleted
          const edges = isTagUsedInFillet({
            ast,
            callExp: segmentNode.node,
          })
          // edge has already been filleted
          if (
            ['edge', 'default'].includes(
              selectionRanges.codeBasedSelections[0].type
            ) &&
            edges.includes('baseEdge')
          )
            return false
          return true
        } else {
          return false
        }
      }
    } else {
      return false
    }
  }

  return canFilletSelection(selectionRanges)
}

type EdgeTypes =
  | 'baseEdge'
  | 'getNextAdjacentEdge'
  | 'getPreviousAdjacentEdge'
  | 'getOppositeEdge'

export const isTagUsedInFillet = ({
  ast,
  callExp,
}: {
  ast: Program
  callExp: CallExpression
}): Array<EdgeTypes> => {
  const tag = getTagFromCallExpression(callExp)
  if (err(tag)) return []

  let inFillet = false
  let inObj = false
  let inTagHelper: EdgeTypes | '' = ''
  const edges: Array<EdgeTypes> = []
  traverse(ast, {
    enter: (node) => {
      if (node.type === 'CallExpression' && node.callee.name === 'fillet') {
        inFillet = true
      }
      if (inFillet && node.type === 'ObjectExpression') {
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
        inFillet &&
        node.type === 'CallExpression' &&
        (node.callee.name === 'getOppositeEdge' ||
          node.callee.name === 'getNextAdjacentEdge' ||
          node.callee.name === 'getPreviousAdjacentEdge')
      ) {
        inTagHelper = node.callee.name
      }
      if (
        inObj &&
        inFillet &&
        !inTagHelper &&
        node.type === 'Identifier' &&
        node.name === tag
      ) {
        edges.push('baseEdge')
      }
      if (
        inObj &&
        inFillet &&
        inTagHelper &&
        node.type === 'Identifier' &&
        node.name === tag
      ) {
        edges.push(inTagHelper)
      }
    },
    leave: (node) => {
      if (node.type === 'CallExpression' && node.callee.name === 'fillet') {
        inFillet = false
      }
      if (inFillet && node.type === 'ObjectExpression') {
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
        inFillet &&
        node.type === 'CallExpression' &&
        (node.callee.name === 'getOppositeEdge' ||
          node.callee.name === 'getNextAdjacentEdge' ||
          node.callee.name === 'getPreviousAdjacentEdge')
      ) {
        inTagHelper = ''
      }
    },
  })

  return edges
}
