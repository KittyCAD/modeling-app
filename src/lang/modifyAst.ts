import {
  Program,
  BlockStatement,
  SketchExpression,
  CallExpression,
  PipeExpression,
  VariableDeclaration,
  ExpressionStatement,
  Value,
  getNodeFromPath,
  VariableDeclarator,
} from './abstractSyntaxTree'
import { PathToNode } from './executor'

export function addSketchTo(
  node: Program,
  axis: 'xy' | 'xz' | 'yz',
  name = ''
): { modifiedAst: Program; id: string; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const _name = name || findUniqueName(node, 'part')
  const sketchBody: BlockStatement = {
    type: 'BlockStatement',
    ...dumbyStartend,
    body: [],
  }
  const sketch: SketchExpression = {
    type: 'SketchExpression',
    ...dumbyStartend,
    body: sketchBody,
  }

  const rotate: CallExpression = {
    type: 'CallExpression',
    ...dumbyStartend,
    callee: {
      type: 'Identifier',
      ...dumbyStartend,
      name: axis === 'xz' ? 'rx' : 'ry',
    },
    arguments: [
      {
        type: 'Literal',
        ...dumbyStartend,
        value: axis === 'yz' ? 90 : 90,
        raw: axis === 'yz' ? '90' : '90',
      },
      {
        type: 'PipeSubstitution',
        ...dumbyStartend,
      },
    ],
    optional: false,
  }

  const pipChain: PipeExpression = {
    type: 'PipeExpression',
    ...dumbyStartend,
    body: [sketch, rotate],
  }

  const sketchVariableDeclaration: VariableDeclaration = {
    type: 'VariableDeclaration',
    ...dumbyStartend,
    kind: 'sketch',
    declarations: [
      {
        type: 'VariableDeclarator',
        ...dumbyStartend,
        id: {
          type: 'Identifier',
          ...dumbyStartend,
          name: _name,
        },
        init: axis === 'xy' ? sketch : pipChain,
      },
    ],
  }
  const showCallIndex = getShowIndex(_node)
  let sketchIndex = showCallIndex
  if (showCallIndex === -1) {
    _node.body = [...node.body, sketchVariableDeclaration]
    sketchIndex = _node.body.length - 1
  } else {
    const newBody = [...node.body]
    newBody.splice(showCallIndex, 0, sketchVariableDeclaration)
    _node.body = newBody
  }
  let pathToNode: (string | number)[] = [
    'body',
    sketchIndex,
    'declarations',
    '0',
    'init',
  ]
  if (axis !== 'xy') {
    pathToNode = [...pathToNode, 'body', '0']
  }

  return {
    modifiedAst: addToShow(_node, _name),
    id: _name,
    pathToNode,
  }
}

function findUniqueName(
  ast: Program | string,
  name: string,
  pad = 3,
  index = 1
): string {
  let searchStr = ''
  if (typeof ast === 'string') {
    searchStr = ast
  } else {
    searchStr = JSON.stringify(ast)
  }
  const indexStr = `${index}`.padStart(pad, '0')
  const newName = `${name}${indexStr}`
  const isInString = searchStr.includes(newName)
  if (!isInString) {
    return newName
  }
  return findUniqueName(searchStr, name, pad, index + 1)
}

function addToShow(node: Program, name: string): Program {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const showCallIndex = getShowIndex(_node)
  if (showCallIndex === -1) {
    const showCall: CallExpression = {
      type: 'CallExpression',
      ...dumbyStartend,
      callee: {
        type: 'Identifier',
        ...dumbyStartend,
        name: 'show',
      },
      optional: false,
      arguments: [
        {
          type: 'Identifier',
          ...dumbyStartend,
          name,
        },
      ],
    }
    const showExpressionStatement: ExpressionStatement = {
      type: 'ExpressionStatement',
      ...dumbyStartend,
      expression: showCall,
    }
    _node.body = [..._node.body, showExpressionStatement]
    return _node
  }
  const showCall = { ..._node.body[showCallIndex] } as ExpressionStatement
  const showCallArgs = (showCall.expression as CallExpression).arguments
  const newShowCallArgs: Value[] = [
    ...showCallArgs,
    {
      type: 'Identifier',
      ...dumbyStartend,
      name,
    },
  ]
  const newShowExpression: CallExpression = {
    type: 'CallExpression',
    ...dumbyStartend,
    callee: {
      type: 'Identifier',
      ...dumbyStartend,
      name: 'show',
    },
    optional: false,
    arguments: newShowCallArgs,
  }

  _node.body[showCallIndex] = {
    ...showCall,
    expression: newShowExpression,
  }
  return _node
}

function getShowIndex(node: Program): number {
  return node.body.findIndex(
    (statement) =>
      statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'CallExpression' &&
      statement.expression.callee.type === 'Identifier' &&
      statement.expression.callee.name === 'show'
  )
}

export function addLine(
  node: Program,
  pathToNode: (string | number)[],
  to: [number, number]
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const { node: sketchExpression } = getNodeFromPath<SketchExpression>(
    _node,
    pathToNode,
    'SketchExpression'
  )
  const line: ExpressionStatement = {
    type: 'ExpressionStatement',
    ...dumbyStartend,
    expression: {
      type: 'CallExpression',
      ...dumbyStartend,
      callee: {
        type: 'Identifier',
        ...dumbyStartend,
        name: 'lineTo',
      },
      optional: false,
      arguments: [
        {
          type: 'Literal',
          ...dumbyStartend,
          value: to[0],
          raw: `${to[0]}`,
        },
        {
          type: 'Literal',
          ...dumbyStartend,
          value: to[1],
          raw: `${to[1]}`,
        },
      ],
    },
  }
  const newBody = [...sketchExpression.body.body, line]
  sketchExpression.body.body = newBody
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

export function changeArguments(
  node: Program,
  pathToNode: (string | number)[],
  args: [number, number]
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  // const thePath = getNodePathFromSourceRange(_node, sourceRange)
  const { node: callExpression } = getNodeFromPath<CallExpression>(
    _node,
    pathToNode
  )
  const newXArg: CallExpression['arguments'][number] =
    callExpression.arguments[0].type === 'Literal'
      ? {
          type: 'Literal',
          ...dumbyStartend,
          value: args[0],
          raw: `${args[0]}`,
        }
      : {
          ...callExpression.arguments[0],
        }
  const newYArg: CallExpression['arguments'][number] =
    callExpression.arguments[1].type === 'Literal'
      ? {
          type: 'Literal',
          ...dumbyStartend,
          value: args[1],
          raw: `${args[1]}`,
        }
      : {
          ...callExpression.arguments[1],
        }
  callExpression.arguments = [newXArg, newYArg]
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

export function extrudeSketch(
  node: Program,
  pathToNode: (string | number)[],
  shouldPipe = true
): {
  modifiedAst: Program
  pathToNode: PathToNode
  pathToExtrudeArg: PathToNode
} {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const { node: sketchExpression } = getNodeFromPath<SketchExpression>(
    _node,
    pathToNode,
    'SketchExpression'
  )

  // determine if sketchExpression is in a pipeExpression or not
  const { node: pipeExpression } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const isInPipeExpression = pipeExpression.type === 'PipeExpression'

  const { node: variableDeclorator, path: pathToDecleration } =
    getNodeFromPath<VariableDeclarator>(_node, pathToNode, 'VariableDeclarator')

  const extrudeCall: CallExpression = {
    type: 'CallExpression',
    ...dumbyStartend,
    callee: {
      type: 'Identifier',
      ...dumbyStartend,
      name: 'extrude',
    },
    optional: false,
    arguments: [
      {
        type: 'Literal',
        ...dumbyStartend,
        value: 4,
        raw: '4',
      },
      shouldPipe
        ? {
            type: 'PipeSubstitution',
            ...dumbyStartend,
          }
        : {
            type: 'Identifier',
            ...dumbyStartend,
            name: variableDeclorator.id.name,
          },
    ],
  }
  if (shouldPipe) {
    const pipeChain: PipeExpression = isInPipeExpression
      ? {
          type: 'PipeExpression',
          ...dumbyStartend,
          body: [...pipeExpression.body, extrudeCall],
        }
      : {
          type: 'PipeExpression',
          ...dumbyStartend,
          body: [sketchExpression, extrudeCall],
        }

    variableDeclorator.init = pipeChain
    const pathToExtrudeArg = [
      ...pathToDecleration,
      'init',
      'body',
      pipeChain.body.length - 1,
      'arguments',
      0,
    ]

    return {
      modifiedAst: _node,
      pathToNode,
      pathToExtrudeArg,
    }
  }
  const name = findUniqueName(node, 'part')
  const VariableDeclaration: VariableDeclaration = {
    type: 'VariableDeclaration',
    ...dumbyStartend,
    declarations: [
      {
        type: 'VariableDeclarator',
        ...dumbyStartend,
        id: {
          type: 'Identifier',
          ...dumbyStartend,
          name,
        },
        init: extrudeCall,
      },
    ],
    kind: 'const',
  }
  const showCallIndex = getShowIndex(_node)
  _node.body.splice(showCallIndex, 0, VariableDeclaration)
  const pathToExtrudeArg = [
    'body',
    showCallIndex,
    'declarations',
    0,
    'init',
    'arguments',
    0,
  ]
  return {
    modifiedAst: addToShow(_node, name),
    pathToNode: [...pathToNode.slice(0, -1), showCallIndex],
    pathToExtrudeArg,
  }
}

export function sketchOnExtrudedFace(
  node: Program,
  pathToNode: (string | number)[]
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const newSketchName = findUniqueName(node, 'part')
  const oldSketchName = getNodeFromPath<VariableDeclarator>(
    _node,
    pathToNode,
    'VariableDeclarator',
    true
  ).node.id.name
  const { node: expression } = getNodeFromPath<
    VariableDeclarator | CallExpression
  >(_node, pathToNode, 'CallExpression')

  const pathName =
    expression.type === 'VariableDeclarator'
      ? expression.id.name
      : findUniqueName(node, 'path', 2)

  if (expression.type === 'CallExpression') {
    const { node: block } = getNodeFromPath<BlockStatement>(
      _node,
      pathToNode,
      'BlockStatement'
    )
    const expressionIndex = getLastIndex(pathToNode)
    if (expression.callee.name !== 'lineTo')
      throw new Error('expected a lineTo call')
    const newExpression: VariableDeclaration = {
      type: 'VariableDeclaration',
      ...dumbyStartend,
      declarations: [
        {
          type: 'VariableDeclarator',
          ...dumbyStartend,
          id: {
            type: 'Identifier',
            ...dumbyStartend,
            name: pathName,
          },
          init: expression,
        },
      ],
      kind: 'path',
    }

    block.body.splice(expressionIndex, 1, newExpression)
  }

  // create pipe expression with a sketch block piped into a transform function
  const sketchPipe: PipeExpression = {
    type: 'PipeExpression',
    ...dumbyStartend,
    body: [
      {
        type: 'SketchExpression',
        ...dumbyStartend,
        body: {
          type: 'BlockStatement',
          ...dumbyStartend,
          body: [],
        },
      },
      {
        type: 'CallExpression',
        ...dumbyStartend,
        callee: {
          type: 'Identifier',
          ...dumbyStartend,
          name: 'transform',
        },
        optional: false,
        arguments: [
          {
            type: 'CallExpression',
            ...dumbyStartend,
            callee: {
              type: 'Identifier',
              ...dumbyStartend,
              name: 'getExtrudeWallTransform',
            },
            optional: false,
            arguments: [
              {
                type: 'Literal',
                ...dumbyStartend,
                value: pathName,
                raw: `'${pathName}'`,
              },
              {
                type: 'Identifier',
                ...dumbyStartend,
                name: oldSketchName,
              },
            ],
          },
          {
            type: 'PipeSubstitution',
            ...dumbyStartend,
          },
        ],
      },
    ],
  }
  const variableDec: VariableDeclaration = {
    type: 'VariableDeclaration',
    ...dumbyStartend,
    declarations: [
      {
        type: 'VariableDeclarator',
        ...dumbyStartend,
        id: {
          type: 'Identifier',
          ...dumbyStartend,
          name: newSketchName,
        },
        init: sketchPipe,
      },
    ],
    kind: 'sketch',
  }

  const showIndex = getShowIndex(_node)
  _node.body.splice(showIndex, 0, variableDec)

  return {
    modifiedAst: addToShow(_node, newSketchName),
    pathToNode,
  }
}

const getLastIndex = (pathToNode: PathToNode): number => {
  const last = pathToNode[pathToNode.length - 1]
  if (typeof last === 'number') {
    return last
  }
  return getLastIndex(pathToNode.slice(0, -1))
}
