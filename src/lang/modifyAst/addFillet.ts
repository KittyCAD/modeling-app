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
import { getNodeFromPath, traverse } from '../queryAst'
import { addTagForSketchOnFace, sketchLineHelperMap } from '../std/sketch'
import { err } from 'lib/trap'
// import { forEach } from 'jszip'

export function addFillet(
  node: Program,
  pathToSegmentNode: PathToNode,
  pathToExtrudeNode: PathToNode,
  radius = createLiteral(5) as Value
  // shouldPipe = false, // TODO: Implement this feature
): { modifiedAst: Program; pathToFilletNode: PathToNode } | Error {
  // close ast to make mutations safe
  let _node: Program = JSON.parse(JSON.stringify(node))

  /**
   * Add Tag to the Segment Expression
   */

  // Find the specific sketch segment to tag with the new tag
  const sketchSegmentChunk = getNodeFromPath(
    _node,
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
  const extrudeChunk = getNodeFromPath<VariableDeclaration>(
    _node,
    pathToExtrudeNode,
    'VariableDeclaration'
  )
  if (err(extrudeChunk)) return extrudeChunk
  const { node: extrudeVarDecl } = extrudeChunk

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
              return prop.value.elements.some((element) => {
                // console.log()
                return element.type === 'Identifier' && element.name === tag
              })
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
    // 2.1. selected edge has the same tag as the existing fillet
    // 2.2. selected edge has a different tag from the existing fillet
    // or no tag at all

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
