import { ProgramMemory, Path, SketchGroup, SourceRange } from '../executor'
import {
  Program,
  PipeExpression,
  CallExpression,
  VariableDeclarator,
  getNodeFromPath,
  getNodePathFromSourceRange,
  Value,
  Literal,
} from '../abstractSyntaxTree'
import { lineGeo } from '../engine'
import { GuiModes } from '../../useStore'

import { SketchLineHelper, ModifyAstBase, InternalFn } from './stdTypes'

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

// import { getYComponent, getXComponent } from '../sketch'

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
  addTag: addTagWithTo('default'),
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
  addTag: addTagWithTo('default'),
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
  addTag: addTagWithTo('length'),
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
  addTag: addTagWithTo('length'),
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
