import {
  ProgramMemory,
  Path,
  SketchGroup,
  SourceRange,
  PathToNode,
  Program,
  PipeExpression,
  CallExpression,
  VariableDeclarator,
  Value,
  Literal,
  VariableDeclaration,
} from '../wasm'
import {
  getNodeFromPath,
  getNodeFromPathCurry,
  getNodePathFromSourceRange,
} from '../queryAst'
import {
  isLiteralArrayOrStatic,
  isNotLiteralArrayOrStatic,
} from './sketchcombos'
import { toolTips, ToolTip } from '../../useStore'
import { createPipeExpression, splitPathAtPipeExpression } from '../modifyAst'

import {
  SketchLineHelper,
  ModifyAstBase,
  TransformCallback,
  ConstrainInfo,
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
import { perpendicularDistance } from 'sketch-helpers'
import { kclManager } from 'lib/singletons'

export type Coords2d = [number, number]

export function getCoordsFromPaths(skGroup: SketchGroup, index = 0): Coords2d {
  const currentPath = skGroup?.value?.[index]
  if (!currentPath && skGroup?.start) {
    return skGroup.start.to
  } else if (!currentPath) {
    return [0, 0]
  }
  if (currentPath.type === 'ToPoint') {
    return [currentPath.to[0], currentPath.to[1]]
  }
  return [0, 0]
}

export function createFirstArg(
  sketchFn: ToolTip,
  val: Value | [Value, Value] | [Value, Value, Value]
): Value {
  if (Array.isArray(val)) {
    if (
      [
        'angledLine',
        'angledLineOfXLength',
        'angledLineOfYLength',
        'angledLineToX',
        'angledLineToY',
        'line',
        'lineTo',
      ].includes(sketchFn)
    )
      return createArrayExpression(val)
    if (['angledLineThatIntersects'].includes(sketchFn) && val[2])
      return createObjectExpression({
        angle: val[0],
        offset: val[1],
        intersectTag: val[2],
      })
  } else {
    if (
      ['startSketchAt', 'xLine', 'xLineTo', 'yLine', 'yLineTo'].includes(
        sketchFn
      )
    )
      return val
  }
  throw new Error('all sketch line types should have been covered')
}

const constrainInfo = (
  a: ConstrainInfo['type'],
  b: ConstrainInfo['isConstrained'],
  c: ConstrainInfo['value'],
  d: ConstrainInfo['sourceRange']
): ConstrainInfo => ({ type: a, isConstrained: b, value: c, sourceRange: d })

const commonConstraintInfoHelper = (
  callExp: CallExpression,
  inputConstrainTypes: [ConstrainInfo['type'], ConstrainInfo['type']]
) => {
  if (callExp.type !== 'CallExpression') return []
  const firstArg = callExp.arguments?.[0]
  if (firstArg.type !== 'ArrayExpression') return []
  const sourceRange1: SourceRange = [
    firstArg.elements[0].start,
    firstArg.elements[0].end,
  ]
  const sourceRange2: SourceRange = [
    firstArg.elements[1].start,
    firstArg.elements[1].end,
  ]
  const val1 = kclManager.code.slice(sourceRange1[0], sourceRange1[1])
  const val2 = kclManager.code.slice(sourceRange2[0], sourceRange2[1])
  return [
    constrainInfo(
      inputConstrainTypes[0],
      isNotLiteralArrayOrStatic(firstArg.elements[0]),
      val1,
      sourceRange1
    ),
    constrainInfo(
      inputConstrainTypes[1],
      isNotLiteralArrayOrStatic(firstArg.elements[1]),
      val2,
      sourceRange2
    ),
  ]
}

const horzVertConstraintInfoHelper = (
  callExp: CallExpression,
  inputConstrainTypes: [ConstrainInfo['type'], ConstrainInfo['type']]
) => {
  if (callExp.type !== 'CallExpression') return []
  const firstArg = callExp.arguments?.[0]
  if (firstArg.type !== 'ArrayExpression') return []
  return [
    constrainInfo(inputConstrainTypes[0], true),
    constrainInfo(
      inputConstrainTypes[1],
      isNotLiteralArrayOrStatic(callExp.arguments?.[0])
    ),
  ]
}

export const lineTo: SketchLineHelper = {
  add: ({
    node,
    pathToNode,
    to,
    createCallback,
    replaceExisting,
    referencedSegment,
  }) => {
    const _node = { ...node }
    const { node: pipe } = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )

    const newVals: [Value, Value] = [
      createLiteral(roundOff(to[0], 2)),
      createLiteral(roundOff(to[1], 2)),
    ]

    const newLine = createCallExpression('lineTo', [
      createArrayExpression(newVals),
      createPipeSubstitution(),
    ])
    const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
    if (replaceExisting && createCallback) {
      const { callExp, valueUsedInTransform } = createCallback(
        newVals,
        referencedSegment
      )
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform: valueUsedInTransform,
      }
    } else {
      pipe.body = [...pipe.body, newLine]
    }
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
  addTag: addTag(),
  getConstraintInfo: (callExp) =>
    commonConstraintInfoHelper(callExp, ['xAbsolute', 'yAbsolute']),
}

export const line: SketchLineHelper = {
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    to,
    from,
    replaceExisting,
    referencedSegment,
    createCallback,
    spliceBetween,
  }) => {
    const _node = { ...node }
    const { node: pipe } = getNodeFromPath<PipeExpression | CallExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    const { node: varDec } = getNodeFromPath<VariableDeclarator>(
      _node,
      pathToNode,
      'VariableDeclarator'
    )

    const newXVal = createLiteral(roundOff(to[0] - from[0], 2))
    const newYVal = createLiteral(roundOff(to[1] - from[1], 2))

    if (spliceBetween && !createCallback && pipe.type === 'PipeExpression') {
      const callExp = createCallExpression('line', [
        createArrayExpression([newXVal, newYVal]),
        createPipeSubstitution(),
      ])
      const pathToNodeIndex = pathToNode.findIndex(
        (x) => x[1] === 'PipeExpression'
      )
      const pipeIndex = pathToNode[pathToNodeIndex + 1][0]
      if (typeof pipeIndex === 'undefined' || typeof pipeIndex === 'string') {
        throw new Error('pipeIndex is undefined')
        // return
      }
      pipe.body = [
        ...pipe.body.slice(0, pipeIndex),
        callExp,
        ...pipe.body.slice(pipeIndex),
      ]
      return {
        modifiedAst: _node,
        pathToNode,
      }
    }

    if (replaceExisting && createCallback && pipe.type !== 'CallExpression') {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback(
        [newXVal, newYVal],
        referencedSegment
      )
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode: [
          ...pathToNode,
          ['body', 'PipeExpression'],
          [callIndex, 'CallExpression'],
        ],
        valueUsedInTransform,
      }
    }

    const callExp = createCallExpression('line', [
      createArrayExpression([newXVal, newYVal]),
      createPipeSubstitution(),
    ])
    if (pipe.type === 'PipeExpression') {
      pipe.body = [...pipe.body, callExp]
      return {
        modifiedAst: _node,
        pathToNode: [
          ...pathToNode,
          ['body', 'PipeExpression'],
          [pipe.body.length - 1, 'CallExpression'],
        ],
      }
    } else {
      varDec.init = createPipeExpression([varDec.init, callExp])
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

    const toArrExp = createArrayExpression([
      createLiteral(roundOff(to[0] - from[0], 2)),
      createLiteral(roundOff(to[1] - from[1], 2)),
    ])

    if (callExpression.arguments?.[0].type === 'ObjectExpression') {
      mutateObjExpProp(callExpression.arguments?.[0], toArrExp, 'to')
    } else {
      mutateArrExp(callExpression.arguments?.[0], toArrExp)
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  addTag: addTag(),
  getConstraintInfo: (callExp) =>
    commonConstraintInfoHelper(callExp, ['xRelative', 'yRelative']),
}

export const xLineTo: SketchLineHelper = {
  add: ({ node, pathToNode, to, replaceExisting, createCallback }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const { node: pipe } = getNode<PipeExpression>('PipeExpression')

    const newVal = createLiteral(roundOff(to[0], 2))

    if (replaceExisting && createCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback([newVal, newVal])
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }
    const callExp = createCallExpression('xLineTo', [
      newVal,
      createPipeSubstitution(),
    ])
    pipe.body = [...pipe.body, callExp]
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
    const newX = createLiteral(roundOff(to[0], 2))
    if (isLiteralArrayOrStatic(callExpression.arguments?.[0])) {
      callExpression.arguments[0] = newX
    } else {
      mutateObjExpProp(callExpression.arguments?.[0], newX, 'to')
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  addTag: addTag(),
  getConstraintInfo: (callExp) =>
    horzVertConstraintInfoHelper(callExp, ['horizontal', 'xAbsolute']),
}

export const yLineTo: SketchLineHelper = {
  add: ({ node, pathToNode, to, replaceExisting, createCallback }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const { node: pipe } = getNode<PipeExpression>('PipeExpression')

    const newVal = createLiteral(roundOff(to[1], 2))

    if (replaceExisting && createCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback([newVal, newVal])
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }
    const callExp = createCallExpression('yLineTo', [
      newVal,
      createPipeSubstitution(),
    ])
    pipe.body = [...pipe.body, callExp]
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
    if (isLiteralArrayOrStatic(callExpression.arguments?.[0])) {
      callExpression.arguments[0] = newY
    } else {
      mutateObjExpProp(callExpression.arguments?.[0], newY, 'to')
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  addTag: addTag(),
  getConstraintInfo: (callExp) =>
    horzVertConstraintInfoHelper(callExp, ['vertical', 'yAbsolute']),
}

export const xLine: SketchLineHelper = {
  add: ({ node, pathToNode, to, from, replaceExisting, createCallback }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const { node: pipe } = getNode<PipeExpression>('PipeExpression')

    const newVal = createLiteral(roundOff(to[0] - from[0], 2))
    const firstArg = newVal

    if (replaceExisting && createCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback([
        firstArg,
        firstArg,
      ])
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }

    const newLine = createCallExpression('xLine', [
      firstArg,
      createPipeSubstitution(),
    ])
    pipe.body = [...pipe.body, newLine]
    return { modifiedAst: _node, pathToNode }
  },
  updateArgs: ({ node, pathToNode, to, from }) => {
    const _node = { ...node }
    const { node: callExpression } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const newX = createLiteral(roundOff(to[0] - from[0], 2))
    if (isLiteralArrayOrStatic(callExpression.arguments?.[0])) {
      callExpression.arguments[0] = newX
    } else {
      mutateObjExpProp(callExpression.arguments?.[0], newX, 'length')
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  addTag: addTag(),
  getConstraintInfo: (callExp) =>
    horzVertConstraintInfoHelper(callExp, ['horizontal', 'xRelative']),
}

export const yLine: SketchLineHelper = {
  add: ({ node, pathToNode, to, from, replaceExisting, createCallback }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const { node: pipe } = getNode<PipeExpression>('PipeExpression')
    const newVal = createLiteral(roundOff(to[1] - from[1], 2))
    if (replaceExisting && createCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback([newVal, newVal])
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }

    const newLine = createCallExpression('yLine', [
      newVal,
      createPipeSubstitution(),
    ])
    pipe.body = [...pipe.body, newLine]
    return { modifiedAst: _node, pathToNode }
  },
  updateArgs: ({ node, pathToNode, to, from }) => {
    const _node = { ...node }
    const { node: callExpression } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const newY = createLiteral(roundOff(to[1] - from[1], 2))
    if (isLiteralArrayOrStatic(callExpression.arguments?.[0])) {
      callExpression.arguments[0] = newY
    } else {
      mutateObjExpProp(callExpression.arguments?.[0], newY, 'length')
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  addTag: addTag(),
  getConstraintInfo: (callExp) =>
    horzVertConstraintInfoHelper(callExp, ['vertical', 'yRelative']),
}

export const tangentialArcTo: SketchLineHelper = {
  add: ({
    node,
    pathToNode,
    to,
    createCallback,
    replaceExisting,
    referencedSegment,
  }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const { node: pipe } = getNode<PipeExpression | CallExpression>(
      'PipeExpression'
    )
    const { node: varDec } = getNodeFromPath<VariableDeclarator>(
      _node,
      pathToNode,
      'VariableDeclarator'
    )

    const toX = createLiteral(roundOff(to[0], 2))
    const toY = createLiteral(roundOff(to[1], 2))

    if (replaceExisting && createCallback && pipe.type !== 'CallExpression') {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback(
        [toX, toY],
        referencedSegment
      )
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }
    const newLine = createCallExpression('tangentialArcTo', [
      createArrayExpression([toX, toY]),
      createPipeSubstitution(),
    ])
    if (pipe.type === 'PipeExpression') {
      pipe.body = [...pipe.body, newLine]
      return {
        modifiedAst: _node,
        pathToNode: [
          ...pathToNode,
          ['body', 'PipeExpression'],
          [pipe.body.length - 1, 'CallExpression'],
        ],
      }
    } else {
      varDec.init = createPipeExpression([varDec.init, newLine])
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
    const x = createLiteral(roundOff(to[0], 2))
    const y = createLiteral(roundOff(to[1], 2))

    const firstArg = callExpression.arguments?.[0]
    if (!mutateArrExp(firstArg, createArrayExpression([x, y]))) {
      mutateObjExpProp(firstArg, createArrayExpression([x, y]), 'to')
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  addTag: addTag(),
  getConstraintInfo: (callExp: CallExpression) => {
    if (callExp.type !== 'CallExpression') return []
    const firstArg = callExp.arguments?.[0]
    if (firstArg.type !== 'ArrayExpression') return []
    return [
      constrainInfo('tangentialWithPrevious', true),
      constrainInfo(
        'xAbsolute',
        isNotLiteralArrayOrStatic(firstArg.elements[0])
      ),
      constrainInfo(
        'yAbsolute',
        isNotLiteralArrayOrStatic(firstArg.elements[1])
      ),
    ]
  },
}
export const angledLine: SketchLineHelper = {
  add: ({
    node,
    pathToNode,
    to,
    from,
    createCallback,
    replaceExisting,
    referencedSegment,
  }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const { node: pipe } = getNode<PipeExpression>('PipeExpression')

    const newAngleVal = createLiteral(roundOff(getAngle(from, to), 0))
    const newLengthVal = createLiteral(roundOff(getLength(from, to), 2))
    const newLine = createCallExpression('angledLine', [
      createArrayExpression([newAngleVal, newLengthVal]),
      createPipeSubstitution(),
    ])

    if (replaceExisting && createCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback(
        [newAngleVal, newLengthVal],
        referencedSegment
      )
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
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
  addTag: addTag(),
  getConstraintInfo: (callExp) =>
    commonConstraintInfoHelper(callExp, ['angle', 'length']),
}

export const angledLineOfXLength: SketchLineHelper = {
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    to,
    from,
    createCallback,
    replaceExisting,
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
    if (sketch.type !== 'SketchGroup') throw new Error('not a SketchGroup')
    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    const xLength = createLiteral(roundOff(Math.abs(from[0] - to[0]), 2) || 0.1)
    const newLine = createCallback
      ? createCallback([angle, xLength]).callExp
      : createCallExpression('angledLineOfXLength', [
          createArrayExpression([angle, xLength]),
          createPipeSubstitution(),
        ])
    const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
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
  addTag: addTag(),
  getConstraintInfo: (callExp) =>
    commonConstraintInfoHelper(callExp, ['angle', 'xRelative']),
}

export const angledLineOfYLength: SketchLineHelper = {
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    to,
    from,
    createCallback,
    replaceExisting,
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
    if (sketch.type !== 'SketchGroup') throw new Error('not a SketchGroup')

    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    const yLength = createLiteral(roundOff(Math.abs(from[1] - to[1]), 2) || 0.1)
    const newLine = createCallback
      ? createCallback([angle, yLength]).callExp
      : createCallExpression('angledLineOfYLength', [
          createArrayExpression([angle, yLength]),
          createPipeSubstitution(),
        ])
    const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
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
  addTag: addTag(),
  getConstraintInfo: (callExp) =>
    commonConstraintInfoHelper(callExp, ['angle', 'yRelative']),
}

export const angledLineToX: SketchLineHelper = {
  add: ({
    node,
    pathToNode,
    to,
    from,
    createCallback,
    replaceExisting,
    referencedSegment,
  }) => {
    const _node = { ...node }
    const { node: pipe } = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    const xArg = createLiteral(roundOff(to[0], 2))
    if (replaceExisting && createCallback) {
      const { callExp, valueUsedInTransform } = createCallback(
        [angle, xArg],
        referencedSegment
      )
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }

    const callExp = createCallExpression('angledLineToX', [
      createArrayExpression([angle, xArg]),
      createPipeSubstitution(),
    ])
    pipe.body = [...pipe.body, callExp]
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
    const angle = roundOff(getAngle(from, to), 0)
    const xLength = roundOff(to[0], 2)

    const firstArg = callExpression.arguments?.[0]
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
  addTag: addTag(),
  getConstraintInfo: (callExp) =>
    commonConstraintInfoHelper(callExp, ['angle', 'xAbsolute']),
}

export const angledLineToY: SketchLineHelper = {
  add: ({
    node,
    pathToNode,
    to,
    from,
    createCallback,
    replaceExisting,
    referencedSegment,
  }) => {
    const _node = { ...node }
    const { node: pipe } = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    const yArg = createLiteral(roundOff(to[1], 2))

    if (replaceExisting && createCallback) {
      const { callExp, valueUsedInTransform } = createCallback(
        [angle, yArg],
        referencedSegment
      )
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }

    const newLine = createCallExpression('angledLineToY', [
      createArrayExpression([angle, yArg]),
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
    const angle = roundOff(getAngle(from, to), 0)
    const xLength = roundOff(to[1], 2)

    const firstArg = callExpression.arguments?.[0]
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
  addTag: addTag(),
  getConstraintInfo: (callExp) =>
    commonConstraintInfoHelper(callExp, ['angle', 'yAbsolute']),
}

export const angledLineThatIntersects: SketchLineHelper = {
  add: ({
    node,
    pathToNode,
    to,
    from,
    createCallback,
    replaceExisting,
    referencedSegment,
  }) => {
    const _node = { ...node }
    const { node: pipe } = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    if (!referencedSegment)
      throw new Error('referencedSegment must be provided')
    const offset = createLiteral(
      roundOff(
        perpendicularDistance(
          referencedSegment?.from,
          referencedSegment?.to,
          to
        ),
        2
      )
    )

    if (replaceExisting && createCallback) {
      const { callExp, valueUsedInTransform } = createCallback([angle, offset])
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }
    throw new Error('not implemented')
  },
  updateArgs: ({ node, pathToNode, to, from, previousProgramMemory }) => {
    const _node = { ...node }
    const { node: callExpression } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode
    )
    const angle = roundOff(getAngle(from, to), 0)

    const firstArg = callExpression.arguments?.[0]
    const intersectTag =
      firstArg.type === 'ObjectExpression'
        ? firstArg.properties.find((p) => p.key.name === 'intersectTag')
            ?.value || createLiteral('')
        : createLiteral('')
    const intersectTagName =
      intersectTag.type === 'Literal' ? intersectTag.value : ''
    const { node: varDec } = getNodeFromPath<VariableDeclaration>(
      _node,
      pathToNode,
      'VariableDeclaration'
    )

    const varName = varDec.declarations[0].id.name
    const sketchGroup = previousProgramMemory.root[varName] as SketchGroup
    const intersectPath = sketchGroup.value.find(
      ({ name }: Path) => name === intersectTagName
    )
    let offset = 0
    if (intersectPath) {
      offset = roundOff(
        perpendicularDistance(intersectPath?.from, intersectPath?.to, to),
        2
      )
    }

    const angleLit = createLiteral(angle)

    mutateObjExpProp(firstArg, angleLit, 'angle')
    mutateObjExpProp(firstArg, createLiteral(offset), 'offset')
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  addTag: addTag(),
  getConstraintInfo: (callExp: CallExpression) => {
    if (callExp.type !== 'CallExpression') return []
    const firstArg = callExp.arguments?.[0]
    if (firstArg.type !== 'ObjectExpression') return []
    const angle = firstArg.properties.find((p) => p.key.name === 'angle')?.value
    const offset = firstArg.properties.find(
      (p) => p.key.name === 'offset'
    )?.value
    const returnVal = []
    angle &&
      returnVal.push(constrainInfo('angle', isNotLiteralArrayOrStatic(angle)))
    offset &&
      returnVal.push(
        constrainInfo('intersectionOffset', isNotLiteralArrayOrStatic(offset))
      )
    return returnVal
  },
}

export const updateStartProfileAtArgs: SketchLineHelper['updateArgs'] = ({
  node,
  pathToNode,
  to,
}) => {
  const _node = { ...node }
  const { node: callExpression } = getNodeFromPath<CallExpression>(
    _node,
    pathToNode
  )

  const toArrExp = createArrayExpression([
    createLiteral(roundOff(to[0])),
    createLiteral(roundOff(to[1])),
  ])

  mutateArrExp(callExpression.arguments?.[0], toArrExp) ||
    mutateObjExpProp(callExpression.arguments?.[0], toArrExp, 'to')
  return {
    modifiedAst: _node,
    pathToNode,
  }
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
  angledLineThatIntersects,
  tangentialArcTo,
} as const

export function changeSketchArguments(
  node: Program,
  programMemory: ProgramMemory,
  sourceRange: SourceRange,
  args: [number, number],
  from: [number, number]
): { modifiedAst: Program; pathToNode: PathToNode } {
  const _node = { ...node }
  const thePath = getNodePathFromSourceRange(_node, sourceRange)
  const { node: callExpression, shallowPath } = getNodeFromPath<CallExpression>(
    _node,
    thePath
  )

  if (callExpression?.callee?.name in sketchLineHelperMap) {
    const { updateArgs } = sketchLineHelperMap[callExpression.callee.name]
    if (!updateArgs) throw new Error('not a sketch line helper')
    return updateArgs({
      node: _node,
      previousProgramMemory: programMemory,
      pathToNode: shallowPath,
      to: args,
      from,
    })
  }

  throw new Error(`not a sketch line helper: ${callExpression?.callee?.name}`)
}

export function getConstraintInfo(
  callExpression: CallExpression
): ConstrainInfo[] {
  const fnName = callExpression?.callee?.name || ''
  if (!(fnName in sketchLineHelperMap)) return []
  return sketchLineHelperMap[fnName].getConstraintInfo(callExpression)
}

export function compareVec2Epsilon(
  vec1: [number, number],
  vec2: [number, number],
  compareEpsilon = 0.015625 // or 2^-6
) {
  const xDifference = Math.abs(vec1[0] - vec2[0])
  const yDifference = Math.abs(vec1[1] - vec2[1])
  return xDifference < compareEpsilon && yDifference < compareEpsilon
}

// this version uses this distance of the two points instead of comparing x and y separately
export function compareVec2Epsilon2(
  vec1: [number, number],
  vec2: [number, number],
  compareEpsilon = 0.015625 // or 2^-6
) {
  const xDifference = Math.abs(vec1[0] - vec2[0])
  const yDifference = Math.abs(vec1[1] - vec2[1])
  const distance = Math.sqrt(
    xDifference * xDifference + yDifference * yDifference
  )
  return distance < compareEpsilon
}

interface CreateLineFnCallArgs {
  node: Program
  programMemory: ProgramMemory
  to: [number, number]
  from: [number, number]
  fnName: ToolTip
  pathToNode: PathToNode
  spliceBetween?: boolean
}

export function addNewSketchLn({
  node: _node,
  programMemory: previousProgramMemory,
  to,
  fnName,
  pathToNode,
  from,
  spliceBetween = false,
}: CreateLineFnCallArgs): {
  modifiedAst: Program
  pathToNode: PathToNode
} {
  const node = JSON.parse(JSON.stringify(_node))
  const { add, updateArgs } = sketchLineHelperMap?.[fnName] || {}
  if (!add || !updateArgs) throw new Error('not a sketch line helper')
  getNodeFromPath<VariableDeclarator>(node, pathToNode, 'VariableDeclarator')
  getNodeFromPath<PipeExpression | CallExpression>(
    node,
    pathToNode,
    'PipeExpression'
  )
  return add({
    node,
    previousProgramMemory,
    pathToNode,
    to,
    from,
    replaceExisting: false,
    spliceBetween,
  })
}

export function addCloseToPipe({
  node,
  pathToNode,
}: {
  node: Program
  programMemory: ProgramMemory
  pathToNode: PathToNode
}) {
  const _node = { ...node }
  const closeExpression = createCallExpression('close', [
    createPipeSubstitution(),
  ])
  const pipeExpression = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  ).node
  if (pipeExpression.type !== 'PipeExpression')
    throw new Error('not a pipe expression')
  pipeExpression.body = [...pipeExpression.body, closeExpression]
  return _node
}

export function replaceSketchLine({
  node,
  programMemory,
  sourceRange,
  fnName,
  to,
  from,
  createCallback,
  referencedSegment,
}: {
  node: Program
  programMemory: ProgramMemory
  sourceRange: SourceRange
  fnName: ToolTip
  to: [number, number]
  from: [number, number]
  createCallback: TransformCallback
  referencedSegment?: Path
}): {
  modifiedAst: Program
  valueUsedInTransform?: number
  pathToNode: PathToNode
} {
  if (![...toolTips, 'intersect'].includes(fnName))
    throw new Error('not a tooltip')
  const _node = { ...node }
  const thePath = getNodePathFromSourceRange(_node, sourceRange)

  const { add } = sketchLineHelperMap[fnName]
  const { modifiedAst, valueUsedInTransform, pathToNode } = add({
    node: _node,
    previousProgramMemory: programMemory,
    pathToNode: thePath,
    referencedSegment,
    to,
    from,
    replaceExisting: true,
    createCallback,
  })
  return { modifiedAst, valueUsedInTransform, pathToNode }
}

export function addTagForSketchOnFace(
  a: ModifyAstBase,
  expressionName: string
) {
  if (expressionName === 'close') {
    return addTag(1)(a)
  }
  if (expressionName in sketchLineHelperMap) {
    const { addTag } = sketchLineHelperMap[expressionName]
    return addTag(a)
  }
  throw new Error(`"${expressionName}" is not a sketch line helper`)
}

function isAngleLiteral(lineArugement: Value): boolean {
  return lineArugement?.type === 'ArrayExpression'
    ? isLiteralArrayOrStatic(lineArugement.elements[0])
    : lineArugement?.type === 'ObjectExpression'
    ? isLiteralArrayOrStatic(
        lineArugement.properties.find(({ key }) => key.name === 'angle')?.value
      )
    : false
}

type addTagFn = (a: ModifyAstBase) => { modifiedAst: Program; tag: string }

function addTag(tagIndex = 2): addTagFn {
  return ({ node, pathToNode }) => {
    const _node = { ...node }
    const { node: primaryCallExp } = getNodeFromPath<CallExpression>(
      _node,
      pathToNode,
      'CallExpression'
    )
    // Tag is always 3rd expression now, using arg index feels brittle
    // but we can come up with a better way to identify tag later.
    const thirdArg = primaryCallExp.arguments?.[tagIndex]
    const tagLiteral =
      thirdArg || (createLiteral(findUniqueName(_node, 'seg', 2)) as Literal)
    const isTagExisting = !!thirdArg
    if (!isTagExisting) {
      primaryCallExp.arguments[tagIndex] = tagLiteral
    }
    if ('value' in tagLiteral) {
      // Now TypeScript knows tagLiteral has a value property
      return {
        modifiedAst: _node,
        tag: String(tagLiteral.value),
      }
    } else {
      throw new Error('Unable to assign tag without value')
    }
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
      callExpression?.callee?.name as ToolTip
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
  const secondArgName = ['xLineTo', 'yLineTo', 'startSketchAt'].includes(
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
  console.warn('expected ArrayExpression or ObjectExpression')
  return {
    val: createLiteral(1),
  }
}

const getAngledLineThatIntersects = (
  callExp: CallExpression
): {
  val: [Value, Value, Value]
  tag?: Value
} => {
  const firstArg = callExp.arguments[0]
  if (firstArg.type === 'ObjectExpression') {
    const tag = firstArg.properties.find((p) => p.key.name === 'tag')?.value
    const angle = firstArg.properties.find((p) => p.key.name === 'angle')?.value
    const offset = firstArg.properties.find(
      (p) => p.key.name === 'offset'
    )?.value
    const intersectTag = firstArg.properties.find(
      (p) => p.key.name === 'intersectTag'
    )?.value
    if (angle && offset && intersectTag) {
      return { val: [angle, offset, intersectTag], tag }
    }
  }
  throw new Error('expected ArrayExpression or ObjectExpression')
}

export function getFirstArg(callExp: CallExpression): {
  val: Value | [Value, Value] | [Value, Value, Value]
  tag?: Value
} {
  const name = callExp?.callee?.name
  if (['lineTo', 'line'].includes(name)) {
    return getFirstArgValuesForXYFns(callExp)
  }
  if (
    [
      'angledLine',
      'angledLineOfXLength',
      'angledLineToX',
      'angledLineOfYLength',
      'angledLineToY',
    ].includes(name)
  ) {
    return getFirstArgValuesForAngleFns(callExp)
  }
  if (['xLine', 'yLine', 'xLineTo', 'yLineTo'].includes(name)) {
    return getFirstArgValuesForXYLineFns(callExp)
  }
  if (['startSketchAt'].includes(name)) {
    return getFirstArgValuesForXYLineFns(callExp)
  }
  if (['angledLineThatIntersects'].includes(name)) {
    return getAngledLineThatIntersects(callExp)
  }
  if (['tangentialArcTo'].includes(name)) {
    // TODO probably needs it's own implementation
    return getFirstArgValuesForXYFns(callExp)
  }
  throw new Error('unexpected call expression')
}
