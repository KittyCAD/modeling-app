import { ProgramMemory, Path, SketchGroup, SourceRange } from '../executor'
import {
  Program,
  PipeExpression,
  CallExpression,
  VariableDeclarator,
  getNodeFromPath,
  getNodePathFromSourceRange,
  Value,
} from '../abstractSyntaxTree'
import { lineGeo } from '../engine'
import { GuiModes } from '../../useStore'

import { SketchLineHelper } from './sketchtypes'

import {
  createLiteral,
  createCallExpression,
  createArrayExpression,
  createPipeSubstitution,
  mutateArrExp,
  mutateObjExpProp,
} from '../modifyAst'
import { roundOff, getLength, getAngle } from '../../lib/utils'

import { getYComponent, getXComponent } from '../sketch'

export type Coords2d = [number, number]

export function getCoordsFromPaths(paths: Path[], index = 0): Coords2d {
  const currentPath = paths[index]
  if (!currentPath) {
    return [0, 0]
  }
  if (currentPath.type === 'horizontalLineTo') {
    const pathBefore = getCoordsFromPaths(paths, index - 1)
    return [currentPath.x, pathBefore[1]]
  } else if (currentPath.type === 'toPoint') {
    return [currentPath.to[0], currentPath.to[1]]
  }
  return [0, 0]
}

const lineTo: SketchLineHelper = {
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
    const from = getCoordsFromPaths(
      sketchGroup.value,
      sketchGroup.value.length - 1
    )
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
}

const line: SketchLineHelper = {
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
    const from = getCoordsFromPaths(
      sketchGroup.value,
      sketchGroup.value.length - 1
    )
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
}

const xLineTo: SketchLineHelper = {
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
      previousSketch.value,
      previousSketch.value.length - 1
    )
    const xVal = typeof data !== 'number' ? data.to : data
    return lineTo.fn(meta, [xVal, from[1]], previousSketch)
  },
  add: ({ node, previousProgramMemory, pathToNode, to }) => {
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
}

const yLineTo: SketchLineHelper = {
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
      previousSketch.value,
      previousSketch.value.length - 1
    )
    const yVal = typeof data !== 'number' ? data.to : data
    return lineTo.fn(meta, [from[0], yVal], previousSketch)
  },
  add: ({ node, previousProgramMemory, pathToNode, to }) => {
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
}

const xLine: SketchLineHelper = {
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
    const xVal = typeof data !== 'number' ? data.length : data
    return line.fn(meta, [xVal, 0], previousSketch)
  },
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    to: length,
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
    const newLine = createCallExpression('xLine', [
      createLiteral(roundOff(length[0] - last.to[0], 2)),
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
}

const yLine: SketchLineHelper = {
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
    const yVal = typeof data !== 'number' ? data.length : data
    return line.fn(meta, [0, yVal], previousSketch)
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
    const newLine = createCallExpression('yLine', [
      createLiteral(roundOff(to[1] - last.to[1], 2)),
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
}

const angledLine: SketchLineHelper = {
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
    const from = getCoordsFromPaths(
      sketchGroup.value,
      sketchGroup.value.length - 1
    )
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
}

const angledLineOfXLength: SketchLineHelper = {
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
    const [angle, length] = 'angle' in data ? [data.angle, data.length] : data
    return line.fn(
      { sourceRange, programMemory },
      getYComponent(angle, length),
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
}

const angledLineOfYLength: SketchLineHelper = {
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
    const [angle, length] = 'angle' in data ? [data.angle, data.length] : data
    return line.fn(
      { sourceRange, programMemory },
      getXComponent(angle, length),
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
}

const angledLineToX: SketchLineHelper = {
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
      previousSketch.value,
      previousSketch.value.length - 1
    )
    const [angle, xTo] = 'angle' in data ? [data.angle, data.to] : data
    const xComponent = xTo - from[0]
    const yComponent = xComponent * Math.tan((angle * Math.PI) / 180)
    return lineTo.fn(
      { sourceRange, programMemory },
      [xTo, from[1] + yComponent],
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
}

const angledLineToY: SketchLineHelper = {
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
      previousSketch.value,
      previousSketch.value.length - 1
    )
    const [angle, yTo] = 'angle' in data ? [data.angle, data.to] : data
    const yComponent = yTo - from[1]
    const xComponent = yComponent / Math.tan((angle * Math.PI) / 180)
    return lineTo.fn(
      { sourceRange, programMemory },
      [from[0] + xComponent, yTo],
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

export function toolTipModification(
  node: Program,
  previousProgramMemory: ProgramMemory,
  to: [number, number],
  guiMode: GuiModes
): { modifiedAst: Program } {
  if (guiMode.mode !== 'sketch') throw new Error('expected sketch mode')

  const mode = guiMode.sketchMode
  if (mode in sketchLineHelperMap && mode !== 'selectFace') {
    const { add } = sketchLineHelperMap[guiMode.sketchMode]
    return add({
      node,
      previousProgramMemory,
      pathToNode: guiMode.pathToNode,
      to,
    })
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
