import {
  ArrayExpression,
  CallExpression,
  ObjectExpression,
  PathToNode,
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
  expectNodeOnPath,
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

export function addFillet(
  node: Program,
  pathToSegmentNode: PathToNode,
  pathToExtrudeNode: PathToNode,
  radius = createLiteral(5) as Value
  // shouldPipe = false, // TODO: Implement this feature
): { modifiedAst: Program; pathToFilletNode: PathToNode } | Error {
  // clone ast to make mutations safe
  let _node = structuredClone(node)

  /**
   * Add Tag to the Segment Expression
   */

  // Find the specific sketch segment to tag with the new tag
  const sketchSegmentNode = expectNodeOnPath<CallExpression>(
    _node,
    pathToSegmentNode,
    'CallExpression'
  )
  if (err(sketchSegmentNode)) return sketchSegmentNode

  // Check whether selection is a valid segment from sketchLineHelpersMap
  if (!(sketchSegmentNode.callee.name in sketchLineHelperMap)) {
    return new Error('Selection is not a sketch segment')
  }

  // Add tag to the sketch segment or use existing tag
  const taggedSegment = addTagForSketchOnFace(
    {
      // previousProgramMemory: programMemory,
      pathToNode: pathToSegmentNode,
      node: _node,
    },
    sketchSegmentNode.callee.name
  )
  if (err(taggedSegment)) return taggedSegment
  const { tag } = taggedSegment

  /**
   * Find Extrude Expression automatically
   */

  // 1. Get the sketch name

  /**
   * Add Fillet to the Extrude expression
   */

  // Create the fillet call expression in one line
  const filletCall = createCallExpressionStdLib('fillet', [
    createObjectExpression({
      radius: radius,
      tags: createArrayExpression([createIdentifier(tag)]),
    }),
    createPipeSubstitution(),
  ])

  // Locate the extrude call
  const extrudeVarDecl = expectNodeOnPath<VariableDeclaration>(
    _node,
    pathToExtrudeNode,
    'VariableDeclaration'
  )
  if (err(extrudeVarDecl)) return extrudeVarDecl

  const extrudeDeclarator = extrudeVarDecl.declarations[0]
  const extrudeInit = extrudeDeclarator.init

  if (
    !extrudeDeclarator ||
    (extrudeInit.type !== 'CallExpression' &&
      extrudeInit.type !== 'PipeExpression')
  ) {
    return new Error('Extrude PipeExpression / CallExpression not found.')
  }

  // determine if extrude is in a PipeExpression or CallExpression

  // CallExpression - no fillet
  // PipeExpression - fillet exists

  const getPathToNodeOfFilletLiteral = (
    pathToExtrudeNode: PathToNode,
    extrudeDeclarator: VariableDeclarator,
    tag: string
  ): PathToNode => {
    let pathToFilletObj: any
    let inFillet = false
    traverse(extrudeDeclarator.init, {
      enter(node, path) {
        if (node.type === 'CallExpression' && node.callee.name === 'fillet') {
          inFillet = true
        }
        if (inFillet && node.type === 'ObjectExpression') {
          const hasTag = node.properties.some((prop) => {
            const isTagProp = prop.key.name === 'tags'
            if (isTagProp && prop.value.type === 'ArrayExpression') {
              return prop.value.elements.some(
                (element) =>
                  element.type === 'Identifier' && element.name === tag
              )
            }
            return false
          })
          if (!hasTag) return false
          pathToFilletObj = path
          node.properties.forEach((prop, index) => {
            if (prop.key.name === 'radius') {
              pathToFilletObj.push(
                ['properties', 'ObjectExpression'],
                [index, 'index'],
                ['value', 'Property']
              )
            }
          })
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

  if (extrudeInit.type === 'CallExpression') {
    // 1. no fillet case
    extrudeDeclarator.init = createPipeExpression([extrudeInit, filletCall])
    return {
      modifiedAst: _node,
      pathToFilletNode: getPathToNodeOfFilletLiteral(
        pathToExtrudeNode,
        extrudeDeclarator,
        tag
      ),
    }
  } else if (extrudeInit.type === 'PipeExpression') {
    // 2. fillet case

    // there are 2 options here:

    const existingFilletCall = extrudeInit.body.find((node) => {
      return node.type === 'CallExpression' && node.callee.name === 'fillet'
    })

    if (!existingFilletCall || existingFilletCall.type !== 'CallExpression') {
      return new Error('Fillet CallExpression not found.')
    }

    // check if the existing fillet has the same tag as the new fillet
    let filletTag = null
    if (existingFilletCall.arguments[0].type === 'ObjectExpression') {
      const properties = (existingFilletCall.arguments[0] as ObjectExpression)
        .properties
      const tagsProperty = properties.find((prop) => prop.key.name === 'tags')
      if (tagsProperty && tagsProperty.value.type === 'ArrayExpression') {
        const elements = (tagsProperty.value as ArrayExpression).elements
        if (elements.length > 0 && elements[0].type === 'Identifier') {
          filletTag = elements[0].name
        }
      }
    } else {
      return new Error('Expected an ObjectExpression node')
    }

    if (filletTag !== tag) {
      extrudeInit.body.push(filletCall)
      return {
        modifiedAst: _node,
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
      if (segmentNode.stopAtNode) {
        const segmentName = segmentNode.stopAtNode.callee.name
        if (segmentName in sketchLineHelperMap) {
          const edges = isTagUsedInFillet({
            ast,
            callExp: segmentNode.stopAtNode,
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
