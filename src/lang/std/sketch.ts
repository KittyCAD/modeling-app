import {
  ProgramMemory,
  Path,
  SketchGroup,
  SourceRange,
  PathToNode,
} from '../executor'
import {
  Program,
  PipeExpression,
  CallExpression,
  VariableDeclarator,
  getNodeFromPath,
  getNodeFromPathCurry,
  getNodePathFromSourceRange,
  Value,
  Literal,
} from '../abstractSyntaxTree'
import { lineGeo } from '../engine'
import { GuiModes, toolTips, TooTip } from '../../useStore'
import { getLastIndex } from '../modifyAst'

import {
  SketchLineHelper,
  ModifyAstBase,
  InternalFn,
  SketchCallTransfromMap,
  TransformCallback,
} from './stdTypes'

import {
  createLiteral,
  createCallExpression,
  createArrayExpression,
  createPipeSubstitution,
  createObjectExpression,
  mutateArrExp,
  mutateObjExpProp,
  findUniqueName,
} from '../modifyAst'
import { roundOff, getLength, getAngle } from '../../lib/utils'

export type Coords2d = [number, number]

export function getCoordsFromPaths(skGroup: SketchGroup, index = 0): Coords2d {
  const currentPath = skGroup?.value?.[index]
  if (!currentPath && skGroup?.start) {
    return skGroup.start
  } else if (!currentPath) {
    return [0, 0]
  }
  if (currentPath.type === 'toPoint') {
    return [currentPath.to[0], currentPath.to[1]]
  }
  return [0, 0]
}

function createCallWrapper(
  a: TooTip,
  val: [Value, Value] | Value,
  tag?: Value
) {
  return createCallExpression(a, [
    createFirstArg(a, val, tag),
    createPipeSubstitution(),
  ])
}

function createFirstArg(
  sketchFn: TooTip,
  val: Value | [Value, Value],
  tag?: Value
): Value {
  if (!tag) {
    if (Array.isArray(val)) {
      return createArrayExpression(val)
    }
    return val
  }
  if (Array.isArray(val)) {
    if (['line', 'lineTo'].includes(sketchFn))
      return createObjectExpression({ to: createArrayExpression(val), tag })
    if (
      ['angledLine', 'angledLineOfXLength', 'angledLineOfYLength'].includes(
        sketchFn
      )
    )
      return createObjectExpression({ angle: val[0], length: val[1], tag })
    if (['angledLineToX', 'angledLineToY'].includes(sketchFn))
      return createObjectExpression({ angle: val[0], to: val[1], tag })
  } else {
    if (['xLine', 'yLine'].includes(sketchFn))
      return createObjectExpression({ length: val, tag })
    if (['xLineTo', 'yLineTo'].includes(sketchFn))
      return createObjectExpression({ to: val, tag })
  }
  throw new Error('all sketch line types should have been covered')
}

function tranformerDefaults(
  filterOut: TooTip[] = [],
  tag?: Value
): Partial<SketchCallTransfromMap> {
  const All: SketchCallTransfromMap = {
    line: (args) => createCallWrapper('line', args, tag),
    lineTo: (args) => createCallWrapper('lineTo', args, tag),
    angledLine: (args) => createCallWrapper('angledLine', args, tag),
    angledLineOfXLength: (args) =>
      createCallWrapper('angledLineOfXLength', args, tag),
    angledLineOfYLength: (args) =>
      createCallWrapper('angledLineOfYLength', args, tag),
    angledLineToX: (args) => createCallWrapper('angledLineToX', args, tag),
    angledLineToY: (args) => createCallWrapper('angledLineToY', args, tag),
    xLine: (args) => createCallWrapper('xLine', args[0], tag),
    xLineTo: (args) => createCallWrapper('xLineTo', args[0], tag),
    yLine: (args) => createCallWrapper('yLine', args[1], tag),
    yLineTo: (args) => createCallWrapper('yLineTo', args[1], tag),
  }
  const result: Partial<SketchCallTransfromMap> = {}
  toolTips.forEach((key) => {
    if (!filterOut.includes(key)) {
      result[key] = All[key]
    }
  })
  return result
}

const lineAndLineToAllowedTransforms: SketchLineHelper['allowedTransforms'] = ({
  node,
  pathToNode,
}: {
  node: Program
  pathToNode: PathToNode
}) => {
  const { node: callExpression } = getNodeFromPath<CallExpression>(
    node,
    pathToNode
  )
  if (
    callExpression.type !== 'CallExpression' ||
    !toolTips.includes(callExpression.callee.name as any)
  )
    return {}
  const fnName = callExpression.callee.name as TooTip
  const firstArg = callExpression.arguments?.[0]
  if (
    firstArg.type !== 'ArrayExpression' &&
    !(firstArg.type === 'ObjectExpression')
  )
    return {}
  const { val, tag } = getFirstArgValuesForXYFns(callExpression)
  const [x, y] = val
  if (x.type !== 'Literal' && y.type !== 'Literal') return {}
  if (x.type !== 'Literal' && y.type === 'Literal' && fnName === 'line')
    return {
      xLine: (args) => createCallWrapper('xLine', x, tag),
      angledLineOfXLength: (args) =>
        createCallWrapper('angledLineOfXLength', [args[0], x], tag),
    }
  if (x.type !== 'Literal' && y.type === 'Literal' && fnName === 'lineTo')
    return {
      xLineTo: (args) => createCallWrapper('xLineTo', x, tag),
      angledLineToX: (args) =>
        createCallWrapper('angledLineToX', [args[0], x], tag),
    }
  if (x.type === 'Literal' && y.type !== 'Literal' && fnName === 'line')
    return {
      yLine: (args) => createCallWrapper('yLine', y, tag),
      angledLineOfYLength: (args) =>
        createCallWrapper('angledLineOfYLength', [args[0], y], tag),
    }
  if (x.type === 'Literal' && y.type !== 'Literal' && fnName === 'lineTo')
    return {
      yLineTo: (args) => createCallWrapper('yLineTo', y, tag),
      angledLineToY: (args) =>
        createCallWrapper('angledLineToY', [args[0], y], tag),
    }
  if (x.type === 'Literal' && y.type === 'Literal')
    return tranformerDefaults([], tag)

  return {}
}

const xyLineAllowedTransforms: SketchLineHelper['allowedTransforms'] = ({
  node,
  pathToNode,
}: {
  node: Program
  pathToNode: PathToNode
}) => {
  const { node: callExpression } = getNodeFromPath<CallExpression>(
    node,
    pathToNode
  )
  if (
    callExpression.type !== 'CallExpression' ||
    !toolTips.includes(callExpression.callee.name as any)
  )
    return {}
  const fnName = callExpression.callee.name
  const firstArg = callExpression.arguments?.[0]
  if (firstArg.type !== 'Literal' && !(firstArg.type === 'ObjectExpression'))
    return {}
  const { val, tag } = getFirstArgValuesForXYLineFns(callExpression)
  const x = val
  if (x.type !== 'Literal' && fnName === 'xLine')
    return {
      xLine: (args) => createCallWrapper('xLine', x, tag),
      line: (args) => createCallWrapper('line', [x, args[1]], tag),
      angledLineOfXLength: (args) =>
        createCallWrapper('angledLineOfXLength', [args[0], x], tag),
    }
  if (x.type !== 'Literal' && fnName === 'xLineTo')
    return {
      xLineTo: (args) => createCallWrapper('xLineTo', x, tag),
      lineTo: (args) => createCallWrapper('lineTo', [x, args[1]], tag),
      angledLineToX: (args) =>
        createCallWrapper('angledLineToX', [args[0], x], tag),
    }
  if (x.type !== 'Literal' && fnName === 'yLine')
    return {
      yLine: (args) => createCallWrapper('yLine', x, tag),
      line: (args) => createCallWrapper('line', [args[0], x], tag),
      angledLineOfYLength: (args) =>
        createCallWrapper('angledLineOfYLength', [args[0], x], tag),
    }
  if (x.type !== 'Literal' && fnName === 'yLineTo')
    return {
      yLineTo: (args) => createCallWrapper('yLineTo', x, tag),
      lineTo: (args) => createCallWrapper('lineTo', [args[0], x], tag),
      angledLineToY: (args) =>
        createCallWrapper('angledLineToY', [args[0], x], tag),
    }
  if (x.type === 'Literal' && fnName.startsWith('yLine'))
    return tranformerDefaults(['yLine'], tag)
  if (x.type === 'Literal' && fnName.startsWith('xLine'))
    return tranformerDefaults(['xLine'], tag)

  return {}
}

const angledLineAllowedTransforms: SketchLineHelper['allowedTransforms'] = ({
  node,
  pathToNode,
}: {
  node: Program
  pathToNode: PathToNode
}) => {
  const { node: callExpression } = getNodeFromPath<CallExpression>(
    node,
    pathToNode
  )
  if (
    callExpression.type !== 'CallExpression' ||
    !toolTips.includes(callExpression.callee.name as any)
  )
    return {}
  const fnName = callExpression.callee.name as TooTip
  const firstArg = callExpression.arguments?.[0]
  if (
    firstArg.type !== 'ArrayExpression' &&
    !(firstArg.type === 'ObjectExpression')
  )
    return {}
  const { val, tag } = getFirstArgValuesForAngleFns(callExpression)
  const [angle, length] = val
  if (angle.type !== 'Literal' && length.type !== 'Literal') return {}
  if (angle.type !== 'Literal' && length.type === 'Literal')
    return {
      angledLineOfYLength: (args) =>
        createCallWrapper('angledLineOfYLength', [angle, args[1]], tag),
      angledLineOfXLength: (args) =>
        createCallWrapper('angledLineOfXLength', [angle, args[1]], tag),
      angledLineToY: (args) =>
        createCallWrapper('angledLineToY', [angle, args[1]], tag),
      angledLineToX: (args) =>
        createCallWrapper('angledLineToX', [angle, args[1]], tag),
      angledLine: (args) =>
        createCallWrapper('angledLine', [angle, args[1]], tag),
    }
  if (
    angle.type === 'Literal' &&
    length.type !== 'Literal' &&
    fnName === 'angledLine'
  )
    return {
      angledLine: (args) =>
        createCallWrapper('angledLine', [args[0], length], tag),
    }
  if (
    angle.type === 'Literal' &&
    length.type !== 'Literal' &&
    fnName === 'angledLineOfXLength'
  )
    return {
      angledLineOfXLength: (args) =>
        createCallWrapper('angledLineOfXLength', [angle, args[1]], tag),
      line: (args) => createCallWrapper('line', [length, args[1]], tag),
      xLine: (args) => createCallWrapper('xLine', length, tag),
    }
  if (
    angle.type === 'Literal' &&
    length.type !== 'Literal' &&
    fnName === 'angledLineOfYLength'
  )
    return {
      angledLineOfYLength: (args) =>
        createCallWrapper('angledLineOfYLength', [args[0], length], tag),
      line: (args) => createCallWrapper('line', [args[0], length], tag),
      yLine: (args) => createCallWrapper('yLine', length, tag),
    }
  if (
    angle.type === 'Literal' &&
    length.type !== 'Literal' &&
    fnName === 'angledLineToX'
  )
    return {
      angledLineToX: (args) =>
        createCallWrapper('angledLineToX', [args[0], length], tag),
      lineTo: (args) => createCallWrapper('lineTo', [length, args[1]], tag),
      xLineTo: (args) => createCallWrapper('xLineTo', length, tag),
    }
  if (
    angle.type === 'Literal' &&
    length.type !== 'Literal' &&
    fnName === 'angledLineToY'
  )
    return {
      angledLineToY: (args) =>
        createCallWrapper('angledLineToY', [args[0], length], tag),
      lineTo: (args) => createCallWrapper('lineTo', [args[0], length], tag),
      yLineTo: (args) => createCallWrapper('yLineTo', length, tag),
    }
  if (angle.type === 'Literal' && length.type === 'Literal')
    return tranformerDefaults([], tag)

  return {}
}

export const lineTo: SketchLineHelper = {
  fn: (
    { sourceRange, programMemory },
    data:
      | [number, number]
      | {
          to: [number, number]
          // name?: string
          tag?: string
        },
    previousSketch: SketchGroup
  ): SketchGroup => {
    if (!previousSketch)
      throw new Error('lineTo must be called after startSketchAt')
    const sketchGroup = { ...previousSketch }
    const from = getCoordsFromPaths(sketchGroup, sketchGroup.value.length - 1)
    const to = 'to' in data ? data.to : data
    const geo = lineGeo({
      from: [...from, 0],
      to: [...to, 0],
    })
    const currentPath: Path = {
      type: 'toPoint',
      to,
      from,
      __geoMeta: {
        sourceRange,
        pathToNode: [], // TODO
        geos: [
          {
            type: 'line',
            geo: geo.line,
          },
          {
            type: 'lineEnd',
            geo: geo.tip,
          },
        ],
      },
    }
    if ('tag' in data) {
      currentPath.name = data.tag
    }
    return {
      ...sketchGroup,
      value: [...sketchGroup.value, currentPath],
    }
  },
  add: ({ node, pathToNode, to }) => {
    const _node = { ...node }
    const { node: pipe } = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    const newLine = createCallExpression('lineTo', [
      createArrayExpression([createLiteral(to[0]), createLiteral(to[1])]),
      createPipeSubstitution(),
    ])
    pipe.body = [...pipe.body, newLine]
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  updateArgs: ({ node, pathToNode, to }) => {
    const _node = { ...node }
    const { node: callExpression } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )

    const toArrExp = createArrayExpression([
      createLiteral(to[0]),
      createLiteral(to[1]),
    ])

    mutateArrExp(callExpression.arguments?.[0], toArrExp) ||
      mutateObjExpProp(callExpression.arguments?.[0], toArrExp, 'to')
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  addTag: addTagWithTo('default'),
  allowedTransforms: lineAndLineToAllowedTransforms,
}

export const line: SketchLineHelper = {
  fn: (
    { sourceRange, programMemory },
    data:
      | [number, number]
      | {
          to: [number, number]
          // name?: string
          tag?: string
        },
    previousSketch: SketchGroup
  ): SketchGroup => {
    if (!previousSketch) throw new Error('lineTo must be called after lineTo')
    const sketchGroup = { ...previousSketch }
    const from = getCoordsFromPaths(sketchGroup, sketchGroup.value.length - 1)
    const args = 'to' in data ? data.to : data
    const to: [number, number] = [from[0] + args[0], from[1] + args[1]]
    const geo = lineGeo({
      from: [...from, 0],
      to: [...to, 0],
    })
    const currentPath: Path = {
      type: 'toPoint',
      to,
      from,
      __geoMeta: {
        sourceRange,
        pathToNode: [], // TODO
        geos: [
          {
            type: 'line',
            geo: geo.line,
          },
          {
            type: 'lineEnd',
            geo: geo.tip,
          },
        ],
      },
    }
    if ('tag' in data) {
      currentPath.name = data.tag
    }
    return {
      ...sketchGroup,
      value: [...sketchGroup.value, currentPath],
    }
  },
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    to,
    // from: [number, number],
  }) => {
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
  },
  updateArgs: ({ node, pathToNode, to, from }) => {
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
  addTag: addTagWithTo('default'),
  allowedTransforms: lineAndLineToAllowedTransforms,
}

export const xLineTo: SketchLineHelper = {
  fn: (
    meta,
    data:
      | number
      | {
          to: number
          // name?: string
          tag?: string
        },
    previousSketch: SketchGroup
  ) => {
    if (!previousSketch) throw new Error('bad bad bad')
    const from = getCoordsFromPaths(
      previousSketch,
      previousSketch.value.length - 1
    )
    const [xVal, tag] = typeof data !== 'number' ? [data.to, data.tag] : [data]
    return lineTo.fn(meta, { to: [xVal, from[1]], tag }, previousSketch)
  },
  add: ({ node, pathToNode, to, replaceExisting, createCallback }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const { node: pipe } = getNode<PipeExpression>('PipeExpression')

    const newVal = createLiteral(roundOff(to[0], 2))
    const firstArg = newVal
    const newLine = createCallback
      ? createCallback([firstArg, firstArg])
      : createCallExpression('xLineTo', [firstArg, createPipeSubstitution()])

    const callIndex = getLastIndex(pathToNode)
    if (replaceExisting) {
      pipe.body[callIndex] = newLine
    } else {
      pipe.body = [...pipe.body, newLine]
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  updateArgs: ({ node, pathToNode, to, from }) => {
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
  addTag: addTagWithTo('default'),
  allowedTransforms: xyLineAllowedTransforms,
}

export const yLineTo: SketchLineHelper = {
  fn: (
    meta,
    data:
      | number
      | {
          to: number
          // name?: string
          tag?: string
        },
    previousSketch: SketchGroup
  ) => {
    if (!previousSketch) throw new Error('bad bad bad')
    const from = getCoordsFromPaths(
      previousSketch,
      previousSketch.value.length - 1
    )
    const [yVal, tag] = typeof data !== 'number' ? [data.to, data.tag] : [data]
    return lineTo.fn(meta, { to: [from[0], yVal], tag }, previousSketch)
  },
  add: ({ node, pathToNode, to, replaceExisting, createCallback }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const { node: pipe } = getNode<PipeExpression>('PipeExpression')

    const newVal = createLiteral(roundOff(to[1], 2))
    const newLine = createCallback
      ? createCallback([newVal, newVal])
      : createCallExpression('yLineTo', [newVal, createPipeSubstitution()])
    const callIndex = getLastIndex(pathToNode)
    if (replaceExisting) {
      pipe.body[callIndex] = newLine
    } else {
      pipe.body = [...pipe.body, newLine]
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  updateArgs: ({ node, pathToNode, to, from }) => {
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
  addTag: addTagWithTo('default'),
  allowedTransforms: xyLineAllowedTransforms,
}

export const xLine: SketchLineHelper = {
  fn: (
    meta,
    data:
      | number
      | {
          length: number
          tag?: string
        },
    previousSketch: SketchGroup
  ) => {
    if (!previousSketch) throw new Error('bad bad bad')
    const [xVal, tag] =
      typeof data !== 'number' ? [data.length, data.tag] : [data]
    return line.fn(meta, { to: [xVal, 0], tag }, previousSketch)
  },
  add: ({ node, pathToNode, to, from, replaceExisting, createCallback }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    if (!from) throw new Error('no from') // todo #29 remove
    const { node: pipe } = getNode<PipeExpression>('PipeExpression')

    const newVal = createLiteral(roundOff(to[0] - from[0], 2))
    const firstArg = newVal
    const newLine = createCallback
      ? createCallback([firstArg, firstArg])
      : createCallExpression('xLine', [firstArg, createPipeSubstitution()])
    const callIndex = getLastIndex(pathToNode)
    if (replaceExisting) {
      pipe.body[callIndex] = newLine
    } else {
      pipe.body = [...pipe.body, newLine]
    }
    return { modifiedAst: _node, pathToNode }
  },
  updateArgs: ({ node, pathToNode, to, from }) => {
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
  addTag: addTagWithTo('length'),
  allowedTransforms: xyLineAllowedTransforms,
}

export const yLine: SketchLineHelper = {
  fn: (
    meta,
    data:
      | number
      | {
          length: number
          // name?: string
          tag?: string
        },
    previousSketch: SketchGroup
  ) => {
    if (!previousSketch) throw new Error('bad bad bad')
    const [yVal, tag] =
      typeof data !== 'number' ? [data.length, data.tag] : [data]
    return line.fn(meta, { to: [0, yVal], tag }, previousSketch)
  },
  add: ({ node, pathToNode, to, from, replaceExisting, createCallback }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    if (!from) throw new Error('no from') // todo #29 remove
    const { node: pipe } = getNode<PipeExpression>('PipeExpression')
    const newVal = createLiteral(roundOff(to[1] - from[1], 2))
    const newLine = createCallback
      ? createCallback([newVal, newVal])
      : createCallExpression('yLine', [newVal, createPipeSubstitution()])
    const callIndex = getLastIndex(pathToNode)
    if (replaceExisting) {
      pipe.body[callIndex] = newLine
    } else {
      pipe.body = [...pipe.body, newLine]
    }
    return { modifiedAst: _node, pathToNode }
  },
  updateArgs: ({ node, pathToNode, to, from }) => {
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
  addTag: addTagWithTo('length'),
  allowedTransforms: xyLineAllowedTransforms,
}

export const angledLine: SketchLineHelper = {
  fn: (
    { sourceRange, programMemory },
    data:
      | [number, number]
      | {
          angle: number
          length: number
          // name?: string
          tag?: string
        },
    previousSketch: SketchGroup
  ) => {
    if (!previousSketch) throw new Error('lineTo must be called after lineTo')
    const sketchGroup = { ...previousSketch }
    const from = getCoordsFromPaths(sketchGroup, sketchGroup.value.length - 1)
    const [angle, length] = 'angle' in data ? [data.angle, data.length] : data
    const to: [number, number] = [
      from[0] + length * Math.cos((angle * Math.PI) / 180),
      from[1] + length * Math.sin((angle * Math.PI) / 180),
    ]
    const geo = lineGeo({
      from: [...from, 0],
      to: [...to, 0],
    })
    const currentPath: Path = {
      type: 'toPoint',
      to,
      from,
      __geoMeta: {
        sourceRange,
        pathToNode: [], // TODO
        geos: [
          {
            type: 'line',
            geo: geo.line,
          },
          {
            type: 'lineEnd',
            geo: geo.tip,
          },
        ],
      },
    }
    if ('tag' in data) {
      currentPath.name = data.tag
    }
    return {
      ...sketchGroup,
      value: [...sketchGroup.value, currentPath],
    }
  },
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    to,
    // from: [number, number],
  }) => {
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
  },
  updateArgs: ({ node, pathToNode, to, from }) => {
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
  addTag: addTagWithTo('angleLength'),
  allowedTransforms: angledLineAllowedTransforms,
}

export const angledLineOfXLength: SketchLineHelper = {
  fn: (
    { sourceRange, programMemory },
    data:
      | [number, number]
      | {
          angle: number
          length: number
          // name?: string
          tag?: string
        },
    previousSketch: SketchGroup
  ) => {
    if (!previousSketch) throw new Error('lineTo must be called after lineTo')
    const [angle, length, tag] =
      'angle' in data ? [data.angle, data.length, data.tag] : data
    return line.fn(
      { sourceRange, programMemory },
      { to: getYComponent(angle, length), tag },
      previousSketch
    )
  },
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    to,
    // from: [number, number],
  }) => {
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
  },
  updateArgs: ({ node, pathToNode, to, from }) => {
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
  addTag: addTagWithTo('angleLength'),
  allowedTransforms: angledLineAllowedTransforms,
}

export const angledLineOfYLength: SketchLineHelper = {
  fn: (
    { sourceRange, programMemory },
    data:
      | [number, number]
      | {
          angle: number
          length: number
          tag?: string
        },
    previousSketch: SketchGroup
  ) => {
    if (!previousSketch) throw new Error('lineTo must be called after lineTo')
    const [angle, length, tag] =
      'angle' in data ? [data.angle, data.length, data.tag] : data
    return line.fn(
      { sourceRange, programMemory },
      { to: getXComponent(angle, length), tag },
      previousSketch
    )
  },
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    to,
    // from: [number, number],
  }) => {
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
  },
  updateArgs: ({ node, pathToNode, to, from }) => {
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
  addTag: addTagWithTo('angleLength'),
  allowedTransforms: angledLineAllowedTransforms,
}

export const angledLineToX: SketchLineHelper = {
  fn: (
    { sourceRange, programMemory },
    data:
      | [number, number]
      | {
          angle: number
          to: number
          tag?: string
        },
    previousSketch: SketchGroup
  ) => {
    if (!previousSketch) throw new Error('lineTo must be called after lineTo')
    const from = getCoordsFromPaths(
      previousSketch,
      previousSketch.value.length - 1
    )
    const [angle, xTo, tag] =
      'angle' in data ? [data.angle, data.to, data.tag] : data
    const xComponent = xTo - from[0]
    const yComponent = xComponent * Math.tan((angle * Math.PI) / 180)
    const yTo = from[1] + yComponent
    return lineTo.fn(
      { sourceRange, programMemory },
      { to: [xTo, yTo], tag },
      previousSketch
    )
  },
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    to,
    // from: [number, number],
  }) => {
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
  },
  updateArgs: ({ node, pathToNode, to, from }) => {
    const _node = { ...node }
    const { node: callExpression, path } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const angle = roundOff(getAngle(from, to), 0)
    const xLength = roundOff(to[0], 2)

    const firstArg = callExpression.arguments?.[0]
    // const adjustedXLength = isAngleLiteral(firstArg)
    //   ? Math.abs(xLength)
    //   : xLength // todo make work for variable angle > 180
    const adjustedXLength = xLength

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
  addTag: addTagWithTo('angleTo'),
  allowedTransforms: angledLineAllowedTransforms,
}

export const angledLineToY: SketchLineHelper = {
  fn: (
    { sourceRange, programMemory },
    data:
      | [number, number]
      | {
          angle: number
          to: number
          tag?: string
        },
    previousSketch: SketchGroup
  ) => {
    if (!previousSketch) throw new Error('lineTo must be called after lineTo')
    const from = getCoordsFromPaths(
      previousSketch,
      previousSketch.value.length - 1
    )
    const [angle, yTo, tag] =
      'angle' in data ? [data.angle, data.to, data.tag] : data
    const yComponent = yTo - from[1]
    const xComponent = yComponent / Math.tan((angle * Math.PI) / 180)
    const xTo = from[0] + xComponent
    return lineTo.fn(
      { sourceRange, programMemory },
      { to: [xTo, yTo], tag },
      previousSketch
    )
  },
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    to,
    // from: [number, number],
  }) => {
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
  },
  updateArgs: ({ node, pathToNode, to, from }) => {
    const _node = { ...node }
    const { node: callExpression, path } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const angle = roundOff(getAngle(from, to), 0)
    const xLength = roundOff(to[1], 2)

    const firstArg = callExpression.arguments?.[0]
    // const adjustedXLength = isAngleLiteral(firstArg)
    //   ? Math.abs(xLength)
    //   : xLength // todo make work for variable angle > 180
    const adjustedXLength = xLength

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
  addTag: addTagWithTo('angleTo'),
  allowedTransforms: angledLineAllowedTransforms,
}

export const sketchLineHelperMap: { [key: string]: SketchLineHelper } = {
  line,
  lineTo,
  xLine,
  yLine,
  xLineTo,
  yLineTo,
  angledLine,
  angledLineOfXLength,
  angledLineOfYLength,
  angledLineToX,
  angledLineToY,
} as const

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

  if (callExpression?.callee?.name in sketchLineHelperMap) {
    const { updateArgs } = sketchLineHelperMap[callExpression.callee.name]
    return updateArgs({
      node: _node,
      previousProgramMemory: programMemory,
      pathToNode: path,
      to: args,
      from,
    })
  }

  throw new Error('not a sketch line helper')
}

interface CreateLineFnCallArgs {
  node: Program
  programMemory: ProgramMemory
  to: [number, number]
  from: [number, number]
  fnName: TooTip
  pathToNode: PathToNode
}

export function addNewSketchLn({
  node,
  programMemory: previousProgramMemory,
  to,
  fnName,
  pathToNode,
}: Omit<CreateLineFnCallArgs, 'from'>): { modifiedAst: Program } {
  const { add } = sketchLineHelperMap[fnName]
  const { node: varDec } = getNodeFromPath<VariableDeclarator>(
    node,
    pathToNode,
    'VariableDeclarator'
  )
  const variableName = varDec.id.name
  const sketch = previousProgramMemory?.root?.[variableName]
  if (sketch.type !== 'sketchGroup') throw new Error('not a sketchGroup')
  const last = sketch.value[sketch.value.length - 1]
  const from = last.to

  return add({
    node,
    previousProgramMemory,
    pathToNode,
    to,
    from,
    replaceExisting: false,
  })
}

export function replaceSketchLine({
  node,
  programMemory,
  sourceRange,
  fnName,
  to,
  from,
  createCallback,
}: {
  node: Program
  programMemory: ProgramMemory
  sourceRange: SourceRange
  fnName: TooTip
  to: [number, number]
  from: [number, number]
  createCallback: TransformCallback
}): { modifiedAst: Program } {
  if (!toolTips.includes(fnName)) throw new Error('not a tooltip')
  const _node = { ...node }
  const thePath = getNodePathFromSourceRange(_node, sourceRange)

  const { add } = sketchLineHelperMap[fnName]
  const { modifiedAst } = add({
    node: _node,
    previousProgramMemory: programMemory,
    pathToNode: thePath,
    to,
    from,
    replaceExisting: true,
    createCallback,
  })
  return { modifiedAst }
}

export function addTagForSketchOnFace(
  a: ModifyAstBase,
  expressionName: string
) {
  if (expressionName in sketchLineHelperMap) {
    const { addTag } = sketchLineHelperMap[expressionName]
    return addTag(a)
  }
  throw new Error('not a sketch line helper')
}

function isAngleLiteral(lineArugement: Value): boolean {
  return lineArugement?.type === 'ArrayExpression'
    ? lineArugement.elements[0].type === 'Literal'
    : lineArugement?.type === 'ObjectExpression'
    ? lineArugement.properties.find(({ key }) => key.name === 'angle')?.value
        .type === 'Literal'
    : false
}

type addTagFn = (a: ModifyAstBase) => { modifiedAst: Program; tag: string }

function addTagWithTo(
  argType: 'angleLength' | 'angleTo' | 'default' | 'length'
): addTagFn {
  return ({ node, pathToNode }) => {
    let tagName = findUniqueName(node, 'seg', 2)
    const _node = { ...node }
    const { node: callExpression } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const firstArg = callExpression.arguments?.[0]
    if (firstArg.type === 'ObjectExpression') {
      const existingTagName = firstArg.properties?.find(
        (prop) => prop.key.name === 'tag'
      )
      if (!existingTagName) {
        mutateObjExpProp(
          callExpression.arguments?.[0],
          createLiteral(tagName),
          'tag'
        )
      } else {
        tagName = `${(existingTagName.value as Literal).value}`
      }
      return {
        modifiedAst: _node,
        tag: tagName,
      }
    }
    if (firstArg.type === 'ArrayExpression') {
      const objExp =
        argType === 'default'
          ? createObjectExpression({
              to: firstArg,
              tag: createLiteral(tagName),
            })
          : argType === 'angleLength'
          ? createObjectExpression({
              angle: firstArg.elements[0],
              length: firstArg.elements[1],
              tag: createLiteral(tagName),
            })
          : createObjectExpression({
              angle: firstArg.elements[0],
              to: firstArg.elements[1],
              tag: createLiteral(tagName),
            })
      callExpression.arguments[0] = objExp
      return {
        modifiedAst: _node,
        tag: tagName,
      }
    }
    if (firstArg.type === 'Literal') {
      const objExp =
        argType === 'length'
          ? createObjectExpression({
              length: firstArg,
              tag: createLiteral(tagName),
            })
          : createObjectExpression({
              to: firstArg,
              tag: createLiteral(tagName),
            })
      callExpression.arguments[0] = objExp
      return {
        modifiedAst: _node,
        tag: tagName,
      }
    }
    throw new Error('lineTo must be called with an object or array')
  }
}

export const closee: InternalFn = (
  { sourceRange, programMemory },
  sketchGroup: SketchGroup
): SketchGroup => {
  const from = getCoordsFromPaths(sketchGroup, sketchGroup.value.length - 1)
  const to = getCoordsFromPaths(sketchGroup, 0)
  const geo = lineGeo({
    from: [...from, 0],
    to: [...to, 0],
  })
  const currentPath: Path = {
    type: 'toPoint',
    to,
    from,
    __geoMeta: {
      sourceRange,
      pathToNode: [], // TODO
      geos: [
        {
          type: 'line',
          geo: geo.line,
        },
        {
          type: 'lineEnd',
          geo: geo.tip,
        },
      ],
    },
  }
  const newValue = [...sketchGroup.value]
  newValue[0] = currentPath
  return {
    ...sketchGroup,
    value: newValue,
  }
}

export const startSketchAt: InternalFn = (
  { sourceRange, programMemory },
  data:
    | [number, number]
    | {
        to: [number, number]
        // name?: string
        tag?: string
      }
): SketchGroup => {
  const to = 'to' in data ? data.to : data
  const currentPath: Path = {
    type: 'toPoint',
    to,
    from: to,
    __geoMeta: {
      sourceRange,
      pathToNode: [], // TODO
      geos: [],
    },
  }
  if ('tag' in data) {
    currentPath.name = data.tag
  }
  return {
    type: 'sketchGroup',
    start: to,
    value: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    __meta: [
      {
        sourceRange,
        pathToNode: [], // TODO
      },
    ],
  }
}

export function getYComponent(
  angleDegree: number,
  xComponent: number
): [number, number] {
  const normalisedAngle = ((angleDegree % 360) + 360) % 360 // between 0 and 360
  let yComponent = xComponent * Math.tan((normalisedAngle * Math.PI) / 180)
  const sign = normalisedAngle > 90 && normalisedAngle <= 270 ? -1 : 1
  return [sign * xComponent, sign * yComponent]
}

export function getXComponent(
  angleDegree: number,
  yComponent: number
): [number, number] {
  const normalisedAngle = ((angleDegree % 360) + 360) % 360 // between 0 and 360
  let xComponent = yComponent / Math.tan((normalisedAngle * Math.PI) / 180)
  const sign = normalisedAngle > 180 && normalisedAngle <= 360 ? -1 : 1
  return [sign * xComponent, sign * yComponent]
}

function getFirstArgValuesForXYFns(callExpression: CallExpression): {
  val: [Value, Value]
  tag?: Value
} {
  // used for lineTo, line
  const firstArg = callExpression.arguments[0]
  if (firstArg.type === 'ArrayExpression') {
    return { val: [firstArg.elements[0], firstArg.elements[1]] }
  }
  if (firstArg.type === 'ObjectExpression') {
    const to = firstArg.properties.find((p) => p.key.name === 'to')?.value
    const tag = firstArg.properties.find((p) => p.key.name === 'tag')?.value
    if (to?.type === 'ArrayExpression') {
      const [x, y] = to.elements
      return { val: [x, y], tag }
    }
  }
  throw new Error('expected ArrayExpression or ObjectExpression')
}

function getFirstArgValuesForAngleFns(callExpression: CallExpression): {
  val: [Value, Value]
  tag?: Value
} {
  // used for angledLine, angledLineOfXLength, angledLineToX, angledLineOfYLength, angledLineToY
  const firstArg = callExpression.arguments[0]
  if (firstArg.type === 'ArrayExpression') {
    return { val: [firstArg.elements[0], firstArg.elements[1]] }
  }
  if (firstArg.type === 'ObjectExpression') {
    const tag = firstArg.properties.find((p) => p.key.name === 'tag')?.value
    const angle = firstArg.properties.find((p) => p.key.name === 'angle')?.value
    const secondArgName = ['angledLineToX', 'angledLineToY'].includes(
      callExpression?.callee?.name as TooTip
    )
      ? 'to'
      : 'length'
    const length = firstArg.properties.find(
      (p) => p.key.name === secondArgName
    )?.value
    if (angle && length) {
      return { val: [angle, length], tag }
    }
  }
  throw new Error('expected ArrayExpression or ObjectExpression')
}

function getFirstArgValuesForXYLineFns(callExpression: CallExpression): {
  val: Value
  tag?: Value
} {
  // used for xLine, yLine, xLineTo, yLineTo
  const firstArg = callExpression.arguments[0]
  if (firstArg.type !== 'ObjectExpression') {
    return { val: firstArg }
  }
  const tag = firstArg.properties.find((p) => p.key.name === 'tag')?.value
  const secondArgName = ['xLineTo', 'yLineTo'].includes(
    // const secondArgName = ['xLineTo', 'yLineTo', 'angledLineToX', 'angledLineToY'].includes(
    callExpression?.callee?.name
  )
    ? 'to'
    : 'length'
  const length = firstArg.properties.find(
    (p) => p.key.name === secondArgName
  )?.value
  if (length) {
    return { val: length, tag }
  }
  throw new Error('expected ArrayExpression or ObjectExpression')
}

export function allowedTransforms(
  a: ModifyAstBase
): Partial<SketchCallTransfromMap> {
  const { node, pathToNode } = a
  const { node: callExpression } = getNodeFromPath<CallExpression>(
    node,
    pathToNode
  )
  if (callExpression.type !== 'CallExpression') return {}
  const expressionName = callExpression?.callee?.name
  const fn = sketchLineHelperMap?.[expressionName]?.allowedTransforms
  if (fn) return fn(a)
  return {}
}
