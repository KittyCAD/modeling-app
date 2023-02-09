import {
  getNodePathFromSourceRange,
  Program,
  BlockStatement,
  SketchExpression,
  CallExpression,
  PipeExpression,
  VariableDeclaration,
  VariableDeclarator,
  ExpressionStatement,
  Value,
  getNodeFromPath,
  Literal,
  PipeSubstitution,
  Identifier,
  ArrayExpression,
  ObjectExpression,
} from './abstractSyntaxTree'
import { PathToNode } from './executor'
import { GuiModes } from '../useStore'
import { ProgramMemory, SourceRange } from './executor'

export function addSketchToV2(
  node: Program,
  axis: 'xy' | 'xz' | 'yz',
  name = ''
): { modifiedAst: Program; id: string; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const _name = name || findUniqueName(node, 'part')

  const startSketchAt = createCallExpression('startSketchAt', [
    createArrayExpression([createLiteral(0), createLiteral(0)]),
  ])
  const rotate = createCallExpression(axis === 'xz' ? 'rx' : 'ry', [
    createLiteral(90),
    createPipeSubstitution(),
  ])
  const initialLineTTo = createCallExpression('lineTTo', [
    createArrayExpression([createLiteral(1), createLiteral(1)]),
    createPipeSubstitution(),
  ])

  const pipeBody =
    axis !== 'xy'
      ? [startSketchAt, rotate, initialLineTTo]
      : [startSketchAt, initialLineTTo]

  const variableDeclaration = createVariableDeclaration(
    _name,
    createPipeExpression(pipeBody)
  )

  const showCallIndex = getShowIndex(_node)
  let sketchIndex = showCallIndex
  if (showCallIndex === -1) {
    _node.body = [...node.body, variableDeclaration]
    sketchIndex = _node.body.length - 1
  } else {
    const newBody = [...node.body]
    newBody.splice(showCallIndex, 0, variableDeclaration)
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

function addLineTToSketch(
  node: Program,
  pathToNode: (string | number)[],
  to: [number, number]
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const { node: pipe } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const newLine = createCallExpression('lineTTo', [
    createArrayExpression([createLiteral(to[0]), createLiteral(to[1])]),
    createPipeSubstitution(),
  ])
  pipe.body = [...pipe.body, newLine]
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

function addXLineTo(
  node: Program,
  previousProgramMemory: ProgramMemory,
  pathToNode: (string | number)[],
  to: [number, number]
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const { node: pipe } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const newLine = createCallExpression('xLineTo', [
    createLiteral(to[0]),
    createPipeSubstitution(),
  ])
  pipe.body = [...pipe.body, newLine]
  return {
    modifiedAst: _node,
    pathToNode,
  }
}
function addYLineTo(
  node: Program,
  previousProgramMemory: ProgramMemory,
  pathToNode: (string | number)[],
  to: [number, number]
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const { node: pipe } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const newLine = createCallExpression('yLineTo', [
    createLiteral(to[1]),
    createPipeSubstitution(),
  ])
  pipe.body = [...pipe.body, newLine]
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

function addRelativeLine(
  node: Program,
  previousProgramMemory: ProgramMemory,
  pathToNode: (string | number)[],
  to: [number, number]
  // from: [number, number],
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const { node: pipe } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const { node: varDec } = getNodeFromPath<VariableDeclarator>(
    _node,
    pathToNode,
    'VariableDeclarator'
  )
  const variableName = varDec.id.name
  const sketch = previousProgramMemory?.root?.[variableName]
  if (sketch.type !== 'sketchGroup') throw new Error('not a sketchGroup')
  const last = sketch.value[sketch.value.length - 1]
  const newLine = createCallExpression('line', [
    createArrayExpression([
      createLiteral(roundOff(to[0] - last.to[0], 2)),
      createLiteral(roundOff(to[1] - last.to[1], 2)),
    ]),
    createPipeSubstitution(),
  ])
  pipe.body = [...pipe.body, newLine]
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

function addYLine(
  node: Program,
  previousProgramMemory: ProgramMemory,
  pathToNode: (string | number)[],
  to: [number, number]
  // from: [number, number],
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const { node: pipe } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const { node: varDec } = getNodeFromPath<VariableDeclarator>(
    _node,
    pathToNode,
    'VariableDeclarator'
  )
  const variableName = varDec.id.name
  const sketch = previousProgramMemory?.root?.[variableName]
  if (sketch.type !== 'sketchGroup') throw new Error('not a sketchGroup')
  const last = sketch.value[sketch.value.length - 1]
  const newLine = createCallExpression('yLine', [
    createLiteral(roundOff(to[1] - last.to[1], 2)),
    createPipeSubstitution(),
  ])
  pipe.body = [...pipe.body, newLine]
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

function addXLine(
  node: Program,
  previousProgramMemory: ProgramMemory,
  pathToNode: (string | number)[],
  length: [number, number]
  // from: [number, number],
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const { node: pipe } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const { node: varDec } = getNodeFromPath<VariableDeclarator>(
    _node,
    pathToNode,
    'VariableDeclarator'
  )
  const variableName = varDec.id.name
  const sketch = previousProgramMemory?.root?.[variableName]
  if (sketch.type !== 'sketchGroup') throw new Error('not a sketchGroup')
  const last = sketch.value[sketch.value.length - 1]
  const newLine = createCallExpression('xLine', [
    createLiteral(roundOff(length[0] - last.to[0], 2)),
    createPipeSubstitution(),
  ])
  pipe.body = [...pipe.body, newLine]
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

function addAngledLine(
  node: Program,
  previousProgramMemory: ProgramMemory,
  pathToNode: (string | number)[],
  to: [number, number]
  // from: [number, number],
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const { node: pipe } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const { node: varDec } = getNodeFromPath<VariableDeclarator>(
    _node,
    pathToNode,
    'VariableDeclarator'
  )
  const variableName = varDec.id.name
  const sketch = previousProgramMemory?.root?.[variableName]
  if (sketch.type !== 'sketchGroup') throw new Error('not a sketchGroup')
  const last = sketch.value[sketch.value.length - 1]
  const angle = roundOff(getAngle(last.to, to), 0)
  const lineLength = roundOff(getLength(last.to, to), 2)
  const newLine = createCallExpression('angledLine', [
    createArrayExpression([createLiteral(angle), createLiteral(lineLength)]),
    createPipeSubstitution(),
  ])
  pipe.body = [...pipe.body, newLine]
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

function addAngledLineOfXLength(
  node: Program,
  previousProgramMemory: ProgramMemory,
  pathToNode: (string | number)[],
  to: [number, number]
  // from: [number, number],
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const { node: pipe } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const { node: varDec } = getNodeFromPath<VariableDeclarator>(
    _node,
    pathToNode,
    'VariableDeclarator'
  )
  const variableName = varDec.id.name
  const sketch = previousProgramMemory?.root?.[variableName]
  if (sketch.type !== 'sketchGroup') throw new Error('not a sketchGroup')
  const last = sketch.value[sketch.value.length - 1]
  const angle = roundOff(getAngle(last.to, to), 0)
  const xLength = roundOff(Math.abs(last.to[0] - to[0]), 2) || 0.1
  const newLine = createCallExpression('angledLineOfXLength', [
    createArrayExpression([createLiteral(angle), createLiteral(xLength)]),
    createPipeSubstitution(),
  ])
  pipe.body = [...pipe.body, newLine]
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

function addAngledLineOfYLength(
  node: Program,
  previousProgramMemory: ProgramMemory,
  pathToNode: (string | number)[],
  to: [number, number]
  // from: [number, number],
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const { node: pipe } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const { node: varDec } = getNodeFromPath<VariableDeclarator>(
    _node,
    pathToNode,
    'VariableDeclarator'
  )
  const variableName = varDec.id.name
  const sketch = previousProgramMemory?.root?.[variableName]
  if (sketch.type !== 'sketchGroup') throw new Error('not a sketchGroup')
  const last = sketch.value[sketch.value.length - 1]
  const angle = roundOff(getAngle(last.to, to), 0)
  const yLength = roundOff(Math.abs(last.to[1] - to[1]), 2) || 0.1
  const newLine = createCallExpression('angledLineOfYLength', [
    createArrayExpression([createLiteral(angle), createLiteral(yLength)]),
    createPipeSubstitution(),
  ])
  pipe.body = [...pipe.body, newLine]
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

function addAngledLineToX(
  node: Program,
  previousProgramMemory: ProgramMemory,
  pathToNode: (string | number)[],
  to: [number, number]
  // from: [number, number],
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const { node: pipe } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const { node: varDec } = getNodeFromPath<VariableDeclarator>(
    _node,
    pathToNode,
    'VariableDeclarator'
  )
  const variableName = varDec.id.name
  const sketch = previousProgramMemory?.root?.[variableName]
  if (sketch.type !== 'sketchGroup') throw new Error('not a sketchGroup')
  const last = sketch.value[sketch.value.length - 1]
  const angle = roundOff(getAngle(last.to, to), 0)
  const xArg = roundOff(to[0], 2)
  const newLine = createCallExpression('angledLineToX', [
    createArrayExpression([createLiteral(angle), createLiteral(xArg)]),
    createPipeSubstitution(),
  ])
  pipe.body = [...pipe.body, newLine]
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

function addAngledLineToY(
  node: Program,
  previousProgramMemory: ProgramMemory,
  pathToNode: (string | number)[],
  to: [number, number]
  // from: [number, number],
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const { node: pipe } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const { node: varDec } = getNodeFromPath<VariableDeclarator>(
    _node,
    pathToNode,
    'VariableDeclarator'
  )
  const variableName = varDec.id.name
  const sketch = previousProgramMemory?.root?.[variableName]
  if (sketch.type !== 'sketchGroup') throw new Error('not a sketchGroup')
  const last = sketch.value[sketch.value.length - 1]
  const angle = roundOff(getAngle(last.to, to), 0)
  const yArg = roundOff(to[1], 2)
  const newLine = createCallExpression('angledLineToY', [
    createArrayExpression([createLiteral(angle), createLiteral(yArg)]),
    createPipeSubstitution(),
  ])
  pipe.body = [...pipe.body, newLine]
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

export function changeSketchArguments(
  node: Program,
  programMemory: ProgramMemory,
  sourceRange: SourceRange,
  args: [number, number],
  guiMode: GuiModes,
  from: [number, number]
): { modifiedAst: Program } {
  const _node = { ...node }
  const thePath = getNodePathFromSourceRange(_node, sourceRange)
  const { node: callExpression, path } = getNodeFromPath<CallExpression>(
    _node,
    thePath
  )
  if (guiMode.mode !== 'sketch') throw new Error('not in sketch mode')

  if (callExpression.callee.name === 'lineTTo') {
    return changeSketchArgumentsHelpers.lineTTo(_node, thePath, args)
  }
  if (callExpression.callee.name === 'line')
    return changeSketchArgumentsHelpers.line(_node, thePath, args, from)
  if (callExpression.callee.name === 'angledLine')
    return changeSketchArgumentsHelpers.angledLine(_node, thePath, args, from)
  if (callExpression.callee.name === 'xLine')
    return changeSketchArgumentsHelpers.xLine(_node, thePath, args, from)
  if (callExpression.callee.name === 'yLine')
    return changeSketchArgumentsHelpers.yLine(_node, thePath, args, from)
  if (callExpression.callee.name === 'xLineTo')
    return changeSketchArgumentsHelpers.xLineTo(_node, thePath, args, from)
  if (callExpression.callee.name === 'yLineTo')
    return changeSketchArgumentsHelpers.yLineTo(_node, thePath, args, from)
  if (callExpression.callee.name === 'angledLineOfXLength')
    return changeSketchArgumentsHelpers.angledLineOfXLength(
      _node,
      thePath,
      args,
      from
    )
  if (callExpression.callee.name === 'angledLineOfYLength')
    return changeSketchArgumentsHelpers.angledLineOfYLength(
      _node,
      thePath,
      args,
      from
    )
  if (callExpression.callee.name === 'angledLineToX')
    return changeSketchArgumentsHelpers.angledLineToX(
      _node,
      thePath,
      args,
      from
    )
  if (callExpression.callee.name === 'angledLineToY')
    return changeSketchArgumentsHelpers.angledLineToY(
      _node,
      thePath,
      args,
      from
    )

  return {
    modifiedAst: _node,
  }
}

const changeSketchArgumentsHelpers = {
  angledLine: (
    node: Program,
    pathToNode: (string | number)[],
    to: [number, number],
    from: [number, number]
  ): { modifiedAst: Program; pathToNode: (string | number)[] } => {
    const _node = { ...node }
    const { node: callExpression, path } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const angle = roundOff(getAngle(from, to), 0)
    const lineLength = roundOff(getLength(from, to), 2)

    const angleLit = createLiteral(angle)
    const lengthLit = createLiteral(lineLength)

    const firstArg = callExpression.arguments?.[0]
    if (!mutateArrExp(firstArg, createArrayExpression([angleLit, lengthLit]))) {
      mutateObjExpProp(firstArg, angleLit, 'angle')
      mutateObjExpProp(firstArg, lengthLit, 'length')
    }

    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  angledLineOfXLength: (
    node: Program,
    pathToNode: (string | number)[],
    to: [number, number],
    from: [number, number]
  ): { modifiedAst: Program; pathToNode: (string | number)[] } => {
    const _node = { ...node }
    const { node: callExpression, path } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const angle = roundOff(getAngle(from, to), 0)
    const xLength = roundOff(Math.abs(to[0] - from[0]), 2)

    const firstArg = callExpression.arguments?.[0]
    const adjustedXLength = isAngleLiteral(firstArg)
      ? Math.abs(xLength)
      : xLength // todo make work for variable angle > 180

    const angleLit = createLiteral(angle)
    const lengthLit = createLiteral(adjustedXLength)

    if (!mutateArrExp(firstArg, createArrayExpression([angleLit, lengthLit]))) {
      mutateObjExpProp(firstArg, angleLit, 'angle')
      mutateObjExpProp(firstArg, lengthLit, 'length')
    }

    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  angledLineOfYLength: (
    node: Program,
    pathToNode: (string | number)[],
    to: [number, number],
    from: [number, number]
  ): { modifiedAst: Program; pathToNode: (string | number)[] } => {
    const _node = { ...node }
    const { node: callExpression, path } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const angle = roundOff(getAngle(from, to), 0)
    const yLength = roundOff(to[1] - from[1], 2)

    const firstArg = callExpression.arguments?.[0]
    const adjustedYLength = isAngleLiteral(firstArg)
      ? Math.abs(yLength)
      : yLength // todo make work for variable angle > 180

    const angleLit = createLiteral(angle)
    const lengthLit = createLiteral(adjustedYLength)

    if (!mutateArrExp(firstArg, createArrayExpression([angleLit, lengthLit]))) {
      mutateObjExpProp(firstArg, angleLit, 'angle')
      mutateObjExpProp(firstArg, lengthLit, 'length')
    }

    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  angledLineToX: (
    node: Program,
    pathToNode: (string | number)[],
    to: [number, number],
    from: [number, number]
  ): { modifiedAst: Program; pathToNode: (string | number)[] } => {
    const _node = { ...node }
    const { node: callExpression, path } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const angle = roundOff(getAngle(from, to), 0)
    const xLength = roundOff(to[0], 2)

    const firstArg = callExpression.arguments?.[0]
    const adjustedXLength = isAngleLiteral(firstArg)
      ? Math.abs(xLength)
      : xLength // todo make work for variable angle > 180

    const angleLit = createLiteral(angle)
    const lengthLit = createLiteral(adjustedXLength)

    if (!mutateArrExp(firstArg, createArrayExpression([angleLit, lengthLit]))) {
      mutateObjExpProp(firstArg, angleLit, 'angle')
      mutateObjExpProp(firstArg, lengthLit, 'to')
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  angledLineToY: (
    node: Program,
    pathToNode: (string | number)[],
    to: [number, number],
    from: [number, number]
  ): { modifiedAst: Program; pathToNode: (string | number)[] } => {
    const _node = { ...node }
    const { node: callExpression, path } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const angle = roundOff(getAngle(from, to), 0)
    const xLength = roundOff(to[1], 2)

    const firstArg = callExpression.arguments?.[0]
    const adjustedXLength = isAngleLiteral(firstArg)
      ? Math.abs(xLength)
      : xLength // todo make work for variable angle > 180

    const angleLit = createLiteral(angle)
    const lengthLit = createLiteral(adjustedXLength)

    if (!mutateArrExp(firstArg, createArrayExpression([angleLit, lengthLit]))) {
      mutateObjExpProp(firstArg, angleLit, 'angle')
      mutateObjExpProp(firstArg, lengthLit, 'to')
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  xLine: (
    node: Program,
    pathToNode: (string | number)[],
    to: [number, number],
    from: [number, number]
  ): { modifiedAst: Program; pathToNode: (string | number)[] } => {
    const _node = { ...node }
    const { node: callExpression } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const newX = createLiteral(roundOff(to[0] - from[0], 2))
    if (callExpression.arguments?.[0]?.type === 'Literal') {
      callExpression.arguments[0] = newX
    } else {
      mutateObjExpProp(callExpression.arguments?.[0], newX, 'length')
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  yLine: (
    node: Program,
    pathToNode: (string | number)[],
    to: [number, number],
    from: [number, number]
  ): { modifiedAst: Program; pathToNode: (string | number)[] } => {
    const _node = { ...node }
    const { node: callExpression } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const newY = createLiteral(roundOff(to[1] - from[1], 2))
    if (callExpression.arguments?.[0]?.type === 'Literal') {
      callExpression.arguments[0] = newY
    } else {
      mutateObjExpProp(callExpression.arguments?.[0], newY, 'length')
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  xLineTo: (
    node: Program,
    pathToNode: (string | number)[],
    to: [number, number],
    from: [number, number]
  ): { modifiedAst: Program; pathToNode: (string | number)[] } => {
    const _node = { ...node }
    const { node: callExpression } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const newX = createLiteral(roundOff(to[0], 2))
    if (callExpression.arguments?.[0]?.type === 'Literal') {
      callExpression.arguments[0] = newX
    } else {
      mutateObjExpProp(callExpression.arguments?.[0], newX, 'to')
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  yLineTo: (
    node: Program,
    pathToNode: (string | number)[],
    to: [number, number],
    from: [number, number]
  ): { modifiedAst: Program; pathToNode: (string | number)[] } => {
    const _node = { ...node }
    const { node: callExpression } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const newY = createLiteral(roundOff(to[1], 2))
    if (callExpression.arguments?.[0]?.type === 'Literal') {
      callExpression.arguments[0] = newY
    } else {
      mutateObjExpProp(callExpression.arguments?.[0], newY, 'to')
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  line: (
    node: Program,
    pathToNode: (string | number)[],
    to: [number, number],
    from: [number, number]
  ): { modifiedAst: Program; pathToNode: (string | number)[] } => {
    const _node = { ...node }
    const { node: callExpression, path } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )

    const toArrExp = createArrayExpression([
      createLiteral(roundOff(to[0] - from[0], 2)),
      createLiteral(roundOff(to[1] - from[1], 2)),
    ])

    mutateArrExp(callExpression.arguments?.[0], toArrExp) ||
      mutateObjExpProp(callExpression.arguments?.[0], toArrExp, 'to')

    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  lineTTo: (
    node: Program,
    pathToNode: (string | number)[],
    args: [number, number]
  ): { modifiedAst: Program; pathToNode: (string | number)[] } => {
    const _node = { ...node }
    const { node: callExpression, path } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )

    const toArrExp = createArrayExpression([
      createLiteral(args[0]),
      createLiteral(args[1]),
    ])

    mutateArrExp(callExpression.arguments?.[0], toArrExp) ||
      mutateObjExpProp(callExpression.arguments?.[0], toArrExp, 'to')
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
}

function isAngleLiteral(lineArugement: Value): boolean {
  return lineArugement?.type === 'ArrayExpression'
    ? lineArugement.elements[0].type === 'Literal'
    : lineArugement?.type === 'ObjectExpression'
    ? lineArugement.properties.find(({ key }) => key.name === 'angle')?.value
        .type === 'Literal'
    : false
}

function mutateArrExp(node: Value, updateWith: ArrayExpression): boolean {
  if (node.type === 'ArrayExpression') {
    node.elements.forEach((element, i) => {
      if (element.type === 'Literal') {
        node.elements[i] = updateWith.elements[i]
      }
    })
    return true
  }
  return false
}

function mutateObjExpProp(
  node: Value,
  updateWith: Literal | ArrayExpression,
  key: string
): boolean {
  if (node.type === 'ObjectExpression') {
    const keyIndex = node.properties.findIndex((a) => a.key.name === key)
    if (keyIndex !== -1) {
      if (
        updateWith.type === 'Literal' &&
        node.properties[keyIndex].value.type === 'Literal'
      ) {
        node.properties[keyIndex].value = updateWith
        return true
      } else if (
        node.properties[keyIndex].value.type === 'ArrayExpression' &&
        updateWith.type === 'ArrayExpression'
      ) {
        const arrExp = node.properties[keyIndex].value as ArrayExpression
        arrExp.elements.forEach((element, i) => {
          if (element.type === 'Literal') {
            arrExp.elements[i] = updateWith.elements[i]
          }
        })
      }
      return true
    }
  }
  return false
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
      createLiteral(4),
      shouldPipe
        ? createPipeSubstitution()
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
          nonCodeMeta: {},
          ...dumbyStartend,
          body: [...pipeExpression.body, extrudeCall],
        }
      : {
          type: 'PipeExpression',
          nonCodeMeta: {},
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
    nonCodeMeta: {},
    ...dumbyStartend,
    body: [
      {
        type: 'SketchExpression',
        ...dumbyStartend,
        body: {
          type: 'BlockStatement',
          ...dumbyStartend,
          body: [],
          nonCodeMeta: {},
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
              createLiteral(pathName),
              {
                type: 'Identifier',
                ...dumbyStartend,
                name: oldSketchName,
              },
            ],
          },
          createPipeSubstitution(),
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

function createLiteral(value: string | number): Literal {
  return {
    type: 'Literal',
    start: 0,
    end: 0,
    value,
    raw: `${value}`,
  }
}

function createIdentifier(name: string): Identifier {
  return {
    type: 'Identifier',
    start: 0,
    end: 0,
    name,
  }
}

function createPipeSubstitution(): PipeSubstitution {
  return {
    type: 'PipeSubstitution',
    start: 0,
    end: 0,
  }
}

function createCallExpression(
  name: string,
  args: CallExpression['arguments']
): CallExpression {
  return {
    type: 'CallExpression',
    start: 0,
    end: 0,
    callee: {
      type: 'Identifier',
      start: 0,
      end: 0,
      name,
    },
    optional: false,
    arguments: args,
  }
}

function createArrayExpression(
  elements: ArrayExpression['elements']
): ArrayExpression {
  return {
    type: 'ArrayExpression',
    start: 0,
    end: 0,
    elements,
  }
}

function createPipeExpression(body: PipeExpression['body']): PipeExpression {
  return {
    type: 'PipeExpression',
    start: 0,
    end: 0,
    body,
    nonCodeMeta: {},
  }
}

function createVariableDeclaration(
  varName: string,
  init: VariableDeclarator['init'],
  kind: VariableDeclaration['kind'] = 'const'
): VariableDeclaration {
  return {
    type: 'VariableDeclaration',
    start: 0,
    end: 0,
    declarations: [
      {
        type: 'VariableDeclarator',
        start: 0,
        end: 0,
        id: createIdentifier(varName),
        init,
      },
    ],
    kind,
  }
}

export function toolTipModification(
  node: Program,
  previousProgramMemory: ProgramMemory,
  to: [number, number],
  guiMode: GuiModes
): { modifiedAst: Program } {
  if (guiMode.mode !== 'sketch') throw new Error('expected sketch mode')

  if (guiMode.sketchMode === 'points')
    return addLineTToSketch(node, guiMode.pathToNode, to)
  if (guiMode.sketchMode === 'relativeLine')
    return addRelativeLine(node, previousProgramMemory, guiMode.pathToNode, to)
  if (guiMode.sketchMode === 'angledLine')
    return addAngledLine(node, previousProgramMemory, guiMode.pathToNode, to)
  if (guiMode.sketchMode === 'xLine')
    return addXLine(node, previousProgramMemory, guiMode.pathToNode, to)
  if (guiMode.sketchMode === 'yLine')
    return addYLine(node, previousProgramMemory, guiMode.pathToNode, to)
  if (guiMode.sketchMode === 'xLineTo')
    return addXLineTo(node, previousProgramMemory, guiMode.pathToNode, to)
  if (guiMode.sketchMode === 'yLineTo')
    return addYLineTo(node, previousProgramMemory, guiMode.pathToNode, to)
  if (guiMode.sketchMode === 'angledLineOfXLength')
    return addAngledLineOfXLength(
      node,
      previousProgramMemory,
      guiMode.pathToNode,
      to
    )
  if (guiMode.sketchMode === 'angledLineOfYLength')
    return addAngledLineOfYLength(
      node,
      previousProgramMemory,
      guiMode.pathToNode,
      to
    )
  if (guiMode.sketchMode === 'angledLineToX')
    return addAngledLineToX(node, previousProgramMemory, guiMode.pathToNode, to)
  if (guiMode.sketchMode === 'angledLineToY')
    return addAngledLineToY(node, previousProgramMemory, guiMode.pathToNode, to)

  throw new Error(`sketchmode: "${guiMode.sketchMode}" has not implemented`)
}

function roundOff(num: number, places: number): number {
  const x = Math.pow(10, places)
  return Math.round(num * x) / x
}

function getLength(a: [number, number], b: [number, number]): number {
  const x = b[0] - a[0]
  const y = b[1] - a[1]
  return Math.sqrt(x * x + y * y)
}

function getAngle(a: [number, number], b: [number, number]): number {
  const x = b[0] - a[0]
  const y = b[1] - a[1]
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
