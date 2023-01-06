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
  index = 1
): string {
  let searchStr = ''
  if (typeof ast === 'string') {
    searchStr = ast
  } else {
    searchStr = JSON.stringify(ast)
  }
  const indexStr = `${index}`.padStart(3, '0')
  const newName = `${name}${indexStr}`
  const isInString = searchStr.includes(newName)
  if (!isInString) {
    return newName
  }
  return findUniqueName(searchStr, name, index + 1)
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
  const sketchExpression = getNodeFromPath(
    _node,
    pathToNode,
    'SketchExpression'
  ) as SketchExpression
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
  const callExpression = getNodeFromPath(_node, pathToNode) as CallExpression
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
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const sketchExpression = getNodeFromPath(
    _node,
    pathToNode,
    'SketchExpression'
  ) as SketchExpression

  // determine if sketchExpression is in a pipeExpression or not
  const pipeExpression = getNodeFromPath(_node, pathToNode, 'PipeExpression')
  const isInPipeExpression = pipeExpression.type === 'PipeExpression'

  const variableDeclorator = getNodeFromPath(
    _node,
    pathToNode,
    'VariableDeclarator'
  ) as VariableDeclarator

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

    return {
      modifiedAst: _node,
      pathToNode,
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
  return {
    modifiedAst: addToShow(_node, name),
    pathToNode: [...pathToNode.slice(0, -1), showCallIndex],
  }
}
