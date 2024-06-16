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
} from '../modifyAst'
import {
  getNodeFromPath,
  getNodePathFromSourceRange,
  traverse,
} from '../queryAst'
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
  let _node = { ...node }

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
  const { tag } = taggedSegment as { modifiedAst: Program; tag: string }

  /**
   * Find Extrude Expression automatically
   */

  // 1. Get the sketch name
  const pathToSketch = [pathToSegmentNode[0], pathToSegmentNode[1]]
  const sketchNode = getNodeFromPath(_node, pathToSketch) as {
    node: VariableDeclaration
  }
  const sketchName = sketchNode.node.declarations[0].id.name

  // 2. Find the extrue expression with the same name
  // TODO: Has to work with Pipe Expressions, Lofts, etc...

  let extrudeRange: [number, number] | undefined = undefined
  _node.body.forEach((node) => {
    traverse(node, {
      enter(node) {
        if (node.type === 'CallExpression') {
          if (node.callee.name === 'extrude') {
            if (
              node.arguments[1].type === 'Identifier' &&
              node.arguments[1].name === sketchName
            ) {
              extrudeRange = [node.start, node.end]
            }
          }
        }
      },
    })
  })

  if (extrudeRange === undefined) {
    return new Error('No valid body found')
  }

  const preselectedPathToExtrudeTag = getNodePathFromSourceRange(
    _node,
    extrudeRange
  )
  const preselectedPathToExtrudeNode = [
    preselectedPathToExtrudeTag[0],
    preselectedPathToExtrudeTag[1],
  ]
  if (pathToExtrudeNode.length < 2) {
    pathToExtrudeNode = preselectedPathToExtrudeNode
  }

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
    'CallExpression'
  )
  if (err(extrudeChunk)) return extrudeChunk
  const { node: extrudeVarDecl } = extrudeChunk as { node: VariableDeclaration }

  const extrudeDeclarator = extrudeVarDecl.declarations[0] as VariableDeclarator
  const extrudeType = extrudeDeclarator.init.type
  let pathToFilletNode: PathToNode = []

  if (
    !extrudeDeclarator ||
    (extrudeType !== 'CallExpression' && extrudeType !== 'PipeExpression')
  ) {
    return new Error('Extrude PipeExpression / CallExpression not found.')
  }

  // determine if extrude is in a PipeExpression or CallExpression

  // CallExpression - no fillet
  // PipeExpression - fillet exists

  let newExtrudePipeExpression: PipeExpression

  if (extrudeType === 'CallExpression') {
    // 1. no fillet case
    const extrudeCall = extrudeDeclarator.init as CallExpression
    newExtrudePipeExpression = {
      type: 'PipeExpression',
      start: extrudeCall.start,
      end: extrudeCall.end,
      body: [extrudeCall, filletCall],
      nonCodeMeta: {
        nonCodeNodes: {},
        start: [],
      },
    }

    pathToFilletNode = [
      ...pathToExtrudeNode,
      ['declarations', 'VariableDeclarator'],
      ['0', 'index'],
      ['init', ''],
      ['body', 'PipeExpression'],
      ['1', 'index'],
      ['arguments', 'CallExpression'],
      ['0', 'index'],
      ['properties', 'ObjectExpression'],
      ['0', 'index'],
      ['value', 'ObjectProperty'],
    ]

    // console.log(' ///////// pathToFilletNode', pathToFilletNode)
  } else if (extrudeType === 'PipeExpression') {
    // 2. fillet case

    // there are 2 options here:
    // 2.1. selected edge has the same tag as the existing fillet
    // 2.2. selected edge has a different tag from the existing fillet
    // or no tag at all

    const extrudeCall = extrudeDeclarator.init as PipeExpression
    const extrudeCallBody = extrudeCall.body
    const existingFilletCall = extrudeCallBody.find((node) => {
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

    if (filletTag === tag) {
      // 2.1. modify the existing fillet call expression
      existingFilletCall.arguments[0].properties[0].value = radius
      pathToFilletNode = [
        ...pathToExtrudeNode,
        ['declarations', 'VariableDeclarator'],
        ['0', 'index'],
        ['init', ''],
        ['body', 'PipeExpression'],
        [extrudeCallBody.indexOf(existingFilletCall), 'index'],
        ['arguments', 'CallExpression'],
        ['0', 'index'],
        ['properties', 'ObjectExpression'],
        ['0', 'index'],
        ['value', 'ObjectProperty'],
      ]
    } else {
      // 2.2. add a new fillet call expression
      extrudeCallBody.push(filletCall)
      pathToFilletNode = [
        ...pathToExtrudeNode,
        ['declarations', 'VariableDeclarator'],
        ['0', 'index'],
        ['init', ''],
        ['body', 'PipeExpression'],
        [extrudeCallBody.length - 1, 'index'],
        ['arguments', 'CallExpression'],
        ['0', 'index'],
        ['properties', 'ObjectExpression'],
        ['0', 'index'],
        ['value', 'ObjectProperty'],
      ]
    }

    newExtrudePipeExpression = {
      type: 'PipeExpression',
      start: extrudeCall.start,
      end: extrudeCall.end,
      body: [...extrudeCallBody],
      nonCodeMeta: {
        nonCodeNodes: {},
        start: [],
      },
    }
  } else {
    return new Error('Unsupported extrude type.')
  }

  extrudeDeclarator.init = newExtrudePipeExpression

  return {
    modifiedAst: _node,
    pathToFilletNode,
  }
}
