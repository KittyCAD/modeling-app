import {
  ArrayExpression,
  CallExpression,
  ObjectExpression,
  PathToNode,
  PipeExpression,
  Program,
  Value,
  VariableDeclaration,
  VariableDeclarator,
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
import { err } from 'lib/trap'
import { Selections, canFilletSelection } from 'lib/selections'

/**
 * Add Fillet
 */

export function addFillet(
  node: Program,
  pathToSegmentNode: PathToNode,
  pathToExtrudeNode: PathToNode,
  radius = createLiteral(5) as Value
): { modifiedAst: Program; pathToFilletNode: PathToNode } | Error {
  // clone ast to make mutations safe
  let _node = structuredClone(node)

  // Tag sketch segment
  const taggedSegment = tagSketchSegment(_node, pathToSegmentNode)
  if (err(taggedSegment)) return taggedSegment
  const { tag } = taggedSegment

  // Create and insert fillet
  const filletCall = createFilletCall(radius, tag)
  return insertFilletCall(filletCall, _node, tag, pathToExtrudeNode)
}

function tagSketchSegment(
  node: Program,
  pathToSegmentNode: PathToNode
): { tag: string } | Error {
  const sketchSegmentChunk = getNodeFromPath(
    node,
    pathToSegmentNode,
    'CallExpression'
  )
  if (err(sketchSegmentChunk)) return sketchSegmentChunk
  const { node: sketchSegmentNode } = sketchSegmentChunk as {
    node: CallExpression
  }

  // Check whether selection is a valid segment from sketchLineHelpersMap
  if (!(sketchSegmentNode.callee.name in sketchLineHelperMap)) {
    return new Error('Selection is not a sketch segment')
  }

  // Add tag to the sketch segment or use existing tag
  const taggedSegment = addTagForSketchOnFace(
    {
      pathToNode: pathToSegmentNode,
      node: node,
    },
    sketchSegmentNode.callee.name
  )

  return taggedSegment
}

function createFilletCall(radius: Value, tag: string): CallExpression {
  return createCallExpressionStdLib('fillet', [
    createObjectExpression({
      radius: radius,
      tags: createArrayExpression([createIdentifier(tag)]),
    }),
    createPipeSubstitution(),
  ])
}

function insertFilletCall(
  filletCall: CallExpression,
  node: Program,
  tag: string,
  pathToExtrudeNode: PathToNode
): { modifiedAst: Program; pathToFilletNode: PathToNode } | Error {
  // Locate the extrude call
  const locatedExtrudeCall = locateExtrudeCall(node, pathToExtrudeNode)
  if (err(locatedExtrudeCall)) return locatedExtrudeCall

  // determine if extrude is in a PipeExpression or CallExpression
  const { extrudeDeclarator, extrudeInit } = locatedExtrudeCall

  // Insert the fillet call based on the type of extrude
  return handleExtrudeType(
    node,
    extrudeDeclarator,
    extrudeInit,
    filletCall,
    pathToExtrudeNode,
    tag
  )
}

function locateExtrudeCall(
  node: Program,
  pathToExtrudeNode: PathToNode
): { extrudeDeclarator: VariableDeclarator; extrudeInit: Value } | Error {
  const extrudeChunk = getNodeFromPath(
    node,
    pathToExtrudeNode,
    'VariableDeclaration'
  )
  if (err(extrudeChunk)) return extrudeChunk

  const { node: extrudeVarDecl } = extrudeChunk as {
    node: VariableDeclaration
  }
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

  const extrudeExpressionType = extrudeInit.type

  return { extrudeDeclarator, extrudeInit }
}

function handleExtrudeType(
  node: Program,
  extrudeDeclarator: VariableDeclarator,
  extrudeInit: Value,
  filletCall: CallExpression,
  pathToExtrudeNode: PathToNode,
  tag: string
): { modifiedAst: Program; pathToFilletNode: PathToNode } | Error {
  // CallExpression - no fillet
  // PipeExpression - fillet exists

  if (extrudeInit.type === 'CallExpression') {
    // 1. no fillet case
    extrudeDeclarator.init = createPipeExpression([extrudeInit, filletCall])
    return {
      modifiedAst: node,
      pathToFilletNode: getPathToNodeOfFilletLiteral(
        pathToExtrudeNode,
        extrudeDeclarator,
        tag
      ),
    }
  } else if (extrudeInit.type === 'PipeExpression') {
    // 2. fillet case
    const existingFilletCall = extrudeInit.body.find((node) => {
      return node.type === 'CallExpression' && node.callee.name === 'fillet'
    })

    if (!existingFilletCall || existingFilletCall.type !== 'CallExpression') {
      return new Error('Fillet CallExpression not found.')
    }

    // check if the existing fillet has the same tag as the new fillet
    const filletTag = getFilletTag(existingFilletCall)

    if (filletTag !== tag) {
      extrudeInit.body.push(filletCall)
      return {
        modifiedAst: node,
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

  return new Error('Unsupported extrude type.')
}

function getPathToNodeOfFilletLiteral(
  pathToExtrudeNode: PathToNode,
  extrudeDeclarator: VariableDeclarator,
  tag: string
): PathToNode {
  let pathToFilletObj: any
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

function getPathToRadiusLiteral(node: ObjectExpression, path: any): any {
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
  selectionRanges: Selections
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
