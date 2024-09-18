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
  Expr,
  VariableDeclaration,
  Identifier,
  sketchGroupFromKclValue,
} from 'lang/wasm'
import {
  getNodeFromPath,
  getNodeFromPathCurry,
  getNodePathFromSourceRange,
  getObjExprProperty,
} from 'lang/queryAst'
import {
  isLiteralArrayOrStatic,
  isNotLiteralArrayOrStatic,
} from 'lang/std/sketchcombos'
import { toolTips, ToolTip } from 'lang/langHelpers'
import { createPipeExpression, splitPathAtPipeExpression } from '../modifyAst'

import {
  SketchLineHelper,
  ConstrainInfo,
  ArrayItemInput,
  ObjectPropertyInput,
  SingleValueInput,
  AddTagInfo,
  SegmentInputs,
  SimplifiedArgDetails,
  RawArgs,
  CreatedSketchExprResult,
} from 'lang/std/stdTypes'

import {
  createLiteral,
  createTagDeclarator,
  createCallExpression,
  createArrayExpression,
  createPipeSubstitution,
  createObjectExpression,
  mutateArrExp,
  mutateObjExpProp,
  findUniqueName,
} from 'lang/modifyAst'
import { roundOff, getLength, getAngle } from 'lib/utils'
import { err } from 'lib/trap'
import { perpendicularDistance } from 'sketch-helpers'
import { TagDeclarator } from 'wasm-lib/kcl/bindings/TagDeclarator'

const STRAIGHT_SEGMENT_ERR = new Error(
  'Invalid input, expected "straight-segment"'
)
const ARC_SEGMENT_ERR = new Error('Invalid input, expected "arc-segment"')

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
  val: Expr | [Expr, Expr] | [Expr, Expr, Expr]
): Expr | Error {
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
  return new Error('Missing sketch line type')
}

type AbbreviatedInput =
  | ArrayItemInput<any>['index']
  | ObjectPropertyInput<any>['key']
  | SingleValueInput<any>['type']
  | SimplifiedArgDetails
  | undefined

const constrainInfo = (
  a: ConstrainInfo['type'],
  b: ConstrainInfo['isConstrained'],
  c: ConstrainInfo['value'],
  f: ConstrainInfo['stdLibFnName'],
  g: AbbreviatedInput,
  d: ConstrainInfo['sourceRange'],
  e: ConstrainInfo['pathToNode']
): ConstrainInfo => ({
  type: a,
  isConstrained: b,
  value: c,
  sourceRange: d,
  argPosition:
    g === 'singleValue'
      ? { type: 'singleValue' }
      : typeof g === 'number'
      ? { type: 'arrayItem', index: g }
      : typeof g === 'string'
      ? { type: 'objectProperty', key: g }
      : undefined,
  pathToNode: e,
  stdLibFnName: f,
})

const commonConstraintInfoHelper = (
  callExp: CallExpression,
  inputConstrainTypes: [ConstrainInfo['type'], ConstrainInfo['type']],
  stdLibFnName: ConstrainInfo['stdLibFnName'],
  abbreviatedInputs: [
    {
      arrayInput?: 0 | 1
      objInput?: ObjectPropertyInput<any>['key']
    },
    {
      arrayInput?: 0 | 1
      objInput?: ObjectPropertyInput<any>['key']
    }
  ],
  code: string,
  pathToNode: PathToNode
) => {
  if (callExp.type !== 'CallExpression') return []
  const firstArg = callExp.arguments?.[0]
  const isArr = firstArg.type === 'ArrayExpression'
  if (!isArr && firstArg.type !== 'ObjectExpression') return []
  const pipeExpressionIndex = pathToNode.findIndex(
    ([_, nodeName]) => nodeName === 'PipeExpression'
  )
  const pathToBase = pathToNode.slice(0, pipeExpressionIndex + 2)
  const pathToArrayExpression: PathToNode = [
    ...pathToBase,
    ['arguments', 'CallExpression'],
    [0, 'index'],
    isArr
      ? ['elements', 'ArrayExpression']
      : ['properties', 'ObjectExpression'],
  ]
  const pathToFirstArg: PathToNode = isArr
    ? [...pathToArrayExpression, [0, 'index']]
    : [
        ...pathToArrayExpression,
        [
          firstArg.properties.findIndex(
            (a) => a.key.name === abbreviatedInputs[0].objInput
          ),
          'index',
        ],
        ['value', 'Property'],
      ]

  const pathToSecondArg: PathToNode = isArr
    ? [...pathToArrayExpression, [1, 'index']]
    : [
        ...pathToArrayExpression,
        [
          firstArg.properties.findIndex(
            (a) => a.key.name === abbreviatedInputs[1].objInput
          ),
          'index',
        ],
        ['value', 'Property'],
      ]

  const input1 = isArr
    ? firstArg.elements[0]
    : firstArg.properties.find(
        (a) => a.key.name === abbreviatedInputs[0].objInput
      )?.value
  const input2 = isArr
    ? firstArg.elements[1]
    : firstArg.properties.find(
        (a) => a.key.name === abbreviatedInputs[1].objInput
      )?.value

  const constraints: ConstrainInfo[] = []
  if (input1)
    constraints.push(
      constrainInfo(
        inputConstrainTypes[0],
        isNotLiteralArrayOrStatic(input1),
        code.slice(input1.start, input1.end),
        stdLibFnName,
        isArr ? abbreviatedInputs[0].arrayInput : abbreviatedInputs[0].objInput,
        [input1.start, input1.end],
        pathToFirstArg
      )
    )
  if (input2)
    constraints.push(
      constrainInfo(
        inputConstrainTypes[1],
        isNotLiteralArrayOrStatic(input2),
        code.slice(input2.start, input2.end),
        stdLibFnName,
        isArr ? abbreviatedInputs[1].arrayInput : abbreviatedInputs[1].objInput,
        [input2.start, input2.end],
        pathToSecondArg
      )
    )

  return constraints
}

const horzVertConstraintInfoHelper = (
  callExp: CallExpression,
  inputConstrainTypes: [ConstrainInfo['type'], ConstrainInfo['type']],
  stdLibFnName: ConstrainInfo['stdLibFnName'],
  abbreviatedInput: AbbreviatedInput,
  code: string,
  pathToNode: PathToNode
) => {
  if (callExp.type !== 'CallExpression') return []
  const firstArg = callExp.arguments?.[0]
  const callee = callExp.callee
  const pathToFirstArg: PathToNode = [
    ...pathToNode,
    ['arguments', 'CallExpression'],
    [0, 'index'],
  ]
  const pathToCallee: PathToNode = [...pathToNode, ['callee', 'CallExpression']]
  return [
    constrainInfo(
      inputConstrainTypes[0],
      true,
      callee.name,
      stdLibFnName,
      undefined,
      [callee.start, callee.end],
      pathToCallee
    ),
    constrainInfo(
      inputConstrainTypes[1],
      isNotLiteralArrayOrStatic(callExp.arguments?.[0]),
      code.slice(firstArg.start, firstArg.end),
      stdLibFnName,
      abbreviatedInput,
      [firstArg.start, firstArg.end],
      pathToFirstArg
    ),
  ]
}

function getTag(index = 2): SketchLineHelper['getTag'] {
  return (callExp: CallExpression) => {
    if (callExp.type !== 'CallExpression')
      return new Error('Not a CallExpression')
    const arg = callExp.arguments?.[index]
    if (!arg) return new Error('No argument')
    if (arg.type !== 'TagDeclarator')
      return new Error('Tag not a TagDeclarator')
    return arg.value
  }
}

export const lineTo: SketchLineHelper = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const to = segmentInput.to
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    if (err(nodeMeta)) return nodeMeta
    const { node: pipe } = nodeMeta

    const newVals: [Expr, Expr] = [
      createLiteral(roundOff(to[0], 2)),
      createLiteral(roundOff(to[1], 2)),
    ]

    const newLine = createCallExpression('lineTo', [
      createArrayExpression(newVals),
      createPipeSubstitution(),
    ])
    const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
    if (replaceExistingCallback) {
      const result = replaceExistingCallback([
        {
          type: 'arrayItem',
          index: 0,
          argType: 'xAbsolute',
          expr: createLiteral(roundOff(to[0], 2)),
        },
        {
          type: 'arrayItem',
          index: 1,
          argType: 'yAbsolute',
          expr: createLiteral(roundOff(to[1], 2)),
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result
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
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta

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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, ...args) =>
    commonConstraintInfoHelper(
      callExp,
      ['xAbsolute', 'yAbsolute'],
      'lineTo',
      [{ arrayInput: 0 }, { arrayInput: 1 }],
      ...args
    ),
}

export const line: SketchLineHelper = {
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
    spliceBetween,
  }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { from, to } = segmentInput
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<PipeExpression | CallExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    if (err(nodeMeta)) return nodeMeta
    const { node: pipe } = nodeMeta
    const nodeMeta2 = getNodeFromPath<VariableDeclarator>(
      _node,
      pathToNode,
      'VariableDeclarator'
    )
    if (err(nodeMeta2)) return nodeMeta2
    const { node: varDec } = nodeMeta2

    const newXVal = createLiteral(roundOff(to[0] - from[0], 2))
    const newYVal = createLiteral(roundOff(to[1] - from[1], 2))

    if (
      spliceBetween &&
      !replaceExistingCallback &&
      pipe.type === 'PipeExpression'
    ) {
      const callExp = createCallExpression('line', [
        createArrayExpression([newXVal, newYVal]),
        createPipeSubstitution(),
      ])
      const pathToNodeIndex = pathToNode.findIndex(
        (x) => x[1] === 'PipeExpression'
      )
      const pipeIndex = pathToNode[pathToNodeIndex + 1][0]
      if (typeof pipeIndex === 'undefined' || typeof pipeIndex === 'string') {
        return new Error('pipeIndex is undefined')
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

    if (replaceExistingCallback && pipe.type !== 'CallExpression') {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const result = replaceExistingCallback([
        {
          type: 'arrayItem',
          index: 0,
          argType: 'xRelative',
          expr: createLiteral(roundOff(to[0] - from[0], 2)),
        },
        {
          type: 'arrayItem',
          index: 1,
          argType: 'yRelative',
          expr: createLiteral(roundOff(to[1] - from[1], 2)),
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode: [...pathToNode],
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
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta

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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, ...args) =>
    commonConstraintInfoHelper(
      callExp,
      ['xRelative', 'yRelative'],
      'line',
      [{ arrayInput: 0 }, { arrayInput: 1 }],
      ...args
    ),
}

export const xLineTo: SketchLineHelper = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to } = segmentInput
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const _node1 = getNode<PipeExpression>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1

    const newVal = createLiteral(roundOff(to[0], 2))

    if (replaceExistingCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const result = replaceExistingCallback([
        {
          type: 'singleValue',
          argType: 'xAbsolute',
          expr: createLiteral(roundOff(to[0], 2)),
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result
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
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, ...args) =>
    horzVertConstraintInfoHelper(
      callExp,
      ['horizontal', 'xAbsolute'],
      'xLineTo',
      'singleValue',
      ...args
    ),
}

export const yLineTo: SketchLineHelper = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to } = segmentInput
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const _node1 = getNode<PipeExpression>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1

    const newVal = createLiteral(roundOff(to[1], 2))

    if (replaceExistingCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const result = replaceExistingCallback([
        {
          type: 'singleValue',
          argType: 'yAbsolute',
          expr: newVal,
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result
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
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, ...args) =>
    horzVertConstraintInfoHelper(
      callExp,
      ['vertical', 'yAbsolute'],
      'yLineTo',
      'singleValue',
      ...args
    ),
}

export const xLine: SketchLineHelper = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { from, to } = segmentInput
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const _node1 = getNode<PipeExpression>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1

    const newVal = createLiteral(roundOff(to[0] - from[0], 2))

    if (replaceExistingCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const result = replaceExistingCallback([
        {
          type: 'singleValue',
          argType: 'xRelative',
          expr: newVal,
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }

    const newLine = createCallExpression('xLine', [
      newVal,
      createPipeSubstitution(),
    ])
    pipe.body = [...pipe.body, newLine]
    return { modifiedAst: _node, pathToNode }
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, ...args) =>
    horzVertConstraintInfoHelper(
      callExp,
      ['horizontal', 'xRelative'],
      'xLine',
      'singleValue',
      ...args
    ),
}

export const yLine: SketchLineHelper = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { from, to } = segmentInput
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const _node1 = getNode<PipeExpression>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1
    const newVal = createLiteral(roundOff(to[1] - from[1], 2))
    if (replaceExistingCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const result = replaceExistingCallback([
        {
          type: 'singleValue',
          argType: 'yRelative',
          expr: newVal,
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result
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
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, ...args) =>
    horzVertConstraintInfoHelper(
      callExp,
      ['vertical', 'yRelative'],
      'yLine',
      'singleValue',
      ...args
    ),
}

export const tangentialArcTo: SketchLineHelper = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to } = segmentInput
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const _node1 = getNode<PipeExpression | CallExpression>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1
    const _node2 = getNodeFromPath<VariableDeclarator>(
      _node,
      pathToNode,
      'VariableDeclarator'
    )
    if (err(_node2)) return _node2
    const { node: varDec } = _node2

    const toX = createLiteral(roundOff(to[0], 2))
    const toY = createLiteral(roundOff(to[1], 2))

    if (replaceExistingCallback && pipe.type !== 'CallExpression') {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const result = replaceExistingCallback([
        {
          type: 'arrayItem',
          index: 0,
          argType: 'xRelative',
          expr: toX,
        },
        {
          type: 'arrayItem',
          index: 1,
          argType: 'yAbsolute',
          expr: toY,
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result
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
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp: CallExpression, code, pathToNode) => {
    if (callExp.type !== 'CallExpression') return []
    const firstArg = callExp.arguments?.[0]
    if (firstArg.type !== 'ArrayExpression') return []
    const callee = callExp.callee
    const pathToCallee: PathToNode = [
      ...pathToNode,
      ['callee', 'CallExpression'],
    ]
    const pathToArrayExpression: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpression'],
      [0, 'index'],
      ['elements', 'ArrayExpression'],
    ]
    const pathToFirstArg: PathToNode = [...pathToArrayExpression, [0, 'index']]
    const pathToSecondArg: PathToNode = [...pathToArrayExpression, [1, 'index']]
    return [
      constrainInfo(
        'tangentialWithPrevious',
        true,
        callee.name,
        'tangentialArcTo',
        undefined,
        [callee.start, callee.end],
        pathToCallee
      ),
      constrainInfo(
        'xAbsolute',
        isNotLiteralArrayOrStatic(firstArg.elements[0]),
        code.slice(firstArg.elements[0].start, firstArg.elements[0].end),
        'tangentialArcTo',
        0,
        [firstArg.elements[0].start, firstArg.elements[0].end],
        pathToFirstArg
      ),
      constrainInfo(
        'yAbsolute',
        isNotLiteralArrayOrStatic(firstArg.elements[1]),
        code.slice(firstArg.elements[1].start, firstArg.elements[1].end),
        'tangentialArcTo',
        1,
        [firstArg.elements[1].start, firstArg.elements[1].end],
        pathToSecondArg
      ),
    ]
  },
}
export const circle: SketchLineHelper = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'arc-segment') return ARC_SEGMENT_ERR

    const { center, radius } = segmentInput
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    if (err(nodeMeta)) return nodeMeta

    const { node: pipe } = nodeMeta

    const x = createLiteral(roundOff(center[0], 2))
    const y = createLiteral(roundOff(center[1], 2))

    const radiusExp = createLiteral(roundOff(radius, 2))

    if (replaceExistingCallback) {
      const result = replaceExistingCallback([
        {
          type: 'arrayInObject',
          index: 0,
          key: 'center',
          argType: 'xAbsolute',
          expr: x,
        },
        {
          type: 'arrayInObject',
          index: 1,
          key: 'center',
          argType: 'yAbsolute',
          expr: y,
        },
        {
          type: 'objectProperty',
          key: 'radius',
          argType: 'radius',
          expr: radiusExp,
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result

      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      pipe.body[callIndex] = callExp

      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }
    return new Error('not implemented')
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'arc-segment') return ARC_SEGMENT_ERR
    const { center, radius } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression, shallowPath } = nodeMeta

    const firstArg = callExpression.arguments?.[0]
    const newCenter = createArrayExpression([
      createLiteral(roundOff(center[0])),
      createLiteral(roundOff(center[1])),
    ])
    mutateObjExpProp(firstArg, newCenter, 'center')
    const newRadius = createLiteral(roundOff(radius))
    mutateObjExpProp(firstArg, newRadius, 'radius')
    return {
      modifiedAst: _node,
      pathToNode: shallowPath,
    }
  },
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp: CallExpression, code, pathToNode) => {
    if (callExp.type !== 'CallExpression') return []
    const firstArg = callExp.arguments?.[0]
    if (firstArg.type !== 'ObjectExpression') return []
    const centerDetails = getObjExprProperty(firstArg, 'center')
    const radiusDetails = getObjExprProperty(firstArg, 'radius')
    if (!centerDetails || !radiusDetails) return []
    if (centerDetails.expr.type !== 'ArrayExpression') return []

    const pathToCenterArrayExpression: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpression'],
      [0, 'index'],
      ['properties', 'ObjectExpression'],
      [centerDetails.index, 'index'],
      ['value', 'Property'],
      ['elements', 'ArrayExpression'],
    ]
    const pathToRadiusLiteral: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpression'],
      [0, 'index'],
      ['properties', 'ObjectExpression'],
      [radiusDetails.index, 'index'],
      ['value', 'Property'],
    ]
    const pathToXArg: PathToNode = [
      ...pathToCenterArrayExpression,
      [0, 'index'],
    ]
    const pathToYArg: PathToNode = [
      ...pathToCenterArrayExpression,
      [1, 'index'],
    ]

    return [
      constrainInfo(
        'radius',
        isNotLiteralArrayOrStatic(radiusDetails.expr),
        code.slice(radiusDetails.expr.start, radiusDetails.expr.end),
        'circle',
        'radius',
        [radiusDetails.expr.start, radiusDetails.expr.end],
        pathToRadiusLiteral
      ),
      {
        stdLibFnName: 'circle',
        type: 'xAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(
          centerDetails.expr.elements[0]
        ),
        sourceRange: [
          centerDetails.expr.elements[0].start,
          centerDetails.expr.elements[0].end,
        ],
        pathToNode: pathToXArg,
        value: code.slice(
          centerDetails.expr.elements[0].start,
          centerDetails.expr.elements[0].end
        ),
        argPosition: {
          type: 'arrayInObject',
          index: 0,
          key: 'center',
        },
      },
      {
        stdLibFnName: 'circle',
        type: 'yAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(
          centerDetails.expr.elements[1]
        ),
        sourceRange: [
          centerDetails.expr.elements[1].start,
          centerDetails.expr.elements[1].end,
        ],
        pathToNode: pathToYArg,
        value: code.slice(
          centerDetails.expr.elements[1].start,
          centerDetails.expr.elements[1].end
        ),
        argPosition: {
          type: 'arrayInObject',
          index: 1,
          key: 'center',
        },
      },
    ]
  },
}
export const angledLine: SketchLineHelper = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { from, to } = segmentInput
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const _node1 = getNode<PipeExpression>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1

    const newAngleVal = createLiteral(roundOff(getAngle(from, to), 0))
    const newLengthVal = createLiteral(roundOff(getLength(from, to), 2))
    const newLine = createCallExpression('angledLine', [
      createArrayExpression([newAngleVal, newLengthVal]),
      createPipeSubstitution(),
    ])

    if (replaceExistingCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const result = replaceExistingCallback([
        {
          type: 'arrayOrObjItem',
          index: 0,
          key: 'angle',
          argType: 'angle',
          expr: newAngleVal,
        },
        {
          type: 'arrayOrObjItem',
          index: 1,
          key: 'length',
          argType: 'length',
          expr: newLengthVal,
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result
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
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, ...args) =>
    commonConstraintInfoHelper(
      callExp,
      ['angle', 'length'],
      'angledLine',
      [
        { arrayInput: 0, objInput: 'angle' },
        { arrayInput: 1, objInput: 'length' },
      ],
      ...args
    ),
}

export const angledLineOfXLength: SketchLineHelper = {
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
  }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { from, to } = segmentInput
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    if (err(nodeMeta)) return nodeMeta
    const { node: pipe } = nodeMeta
    const nodeMeta2 = getNodeFromPath<VariableDeclarator>(
      _node,
      pathToNode,
      'VariableDeclarator'
    )
    if (err(nodeMeta2)) return nodeMeta2
    const { node: varDec } = nodeMeta2

    const variableName = varDec.id.name
    const sketch = sketchGroupFromKclValue(
      previousProgramMemory?.get(variableName),
      variableName
    )
    if (err(sketch)) {
      return sketch
    }
    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    const xLength = createLiteral(roundOff(Math.abs(from[0] - to[0]), 2) || 0.1)
    let newLine: Expr
    if (replaceExistingCallback) {
      const result = replaceExistingCallback([
        {
          type: 'arrayOrObjItem',
          index: 0,
          key: 'angle',
          argType: 'angle',
          expr: angle,
        },
        {
          type: 'arrayOrObjItem',
          index: 1,
          key: 'length',
          argType: 'xRelative',
          expr: xLength,
        },
      ])
      if (err(result)) return result
      newLine = result.callExp
    } else {
      newLine = createCallExpression('angledLineOfXLength', [
        createArrayExpression([angle, xLength]),
        createPipeSubstitution(),
      ])
    }
    const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
    if (replaceExistingCallback) {
      pipe.body[callIndex] = newLine
    } else {
      pipe.body = [...pipe.body, newLine]
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, ...args) =>
    commonConstraintInfoHelper(
      callExp,
      ['angle', 'xRelative'],
      'angledLineOfXLength',
      [
        { arrayInput: 0, objInput: 'angle' },
        { arrayInput: 1, objInput: 'length' },
      ],
      ...args
    ),
}

export const angledLineOfYLength: SketchLineHelper = {
  add: ({
    node,
    previousProgramMemory,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
  }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { from, to } = segmentInput
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    if (err(nodeMeta)) return nodeMeta
    const { node: pipe } = nodeMeta
    const nodeMeta2 = getNodeFromPath<VariableDeclarator>(
      _node,
      pathToNode,
      'VariableDeclarator'
    )
    if (err(nodeMeta2)) return nodeMeta2
    const { node: varDec } = nodeMeta2
    const variableName = varDec.id.name
    const sketch = sketchGroupFromKclValue(
      previousProgramMemory?.get(variableName),
      variableName
    )
    if (err(sketch)) return sketch

    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    const yLength = createLiteral(roundOff(Math.abs(from[1] - to[1]), 2) || 0.1)
    let newLine: Expr
    if (replaceExistingCallback) {
      const result = replaceExistingCallback([
        {
          type: 'arrayOrObjItem',
          index: 0,
          key: 'angle',
          argType: 'angle',
          expr: angle,
        },
        {
          type: 'arrayOrObjItem',
          index: 1,
          key: 'length',
          argType: 'yRelative',
          expr: yLength,
        },
      ])
      if (err(result)) return result
      newLine = result.callExp
    } else {
      newLine = createCallExpression('angledLineOfYLength', [
        createArrayExpression([angle, yLength]),
        createPipeSubstitution(),
      ])
    }
    const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
    if (replaceExistingCallback) {
      pipe.body[callIndex] = newLine
    } else {
      pipe.body = [...pipe.body, newLine]
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, ...args) =>
    commonConstraintInfoHelper(
      callExp,
      ['angle', 'yRelative'],
      'angledLineOfYLength',
      [
        { arrayInput: 0, objInput: 'angle' },
        { arrayInput: 1, objInput: 'length' },
      ],
      ...args
    ),
}

export const angledLineToX: SketchLineHelper = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { from, to } = segmentInput
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    if (err(nodeMeta)) return nodeMeta

    const { node: pipe } = nodeMeta
    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    const xArg = createLiteral(roundOff(to[0], 2))
    if (replaceExistingCallback) {
      const result = replaceExistingCallback([
        {
          type: 'arrayOrObjItem',
          index: 0,
          key: 'angle',
          argType: 'angle',
          expr: angle,
        },
        {
          type: 'arrayOrObjItem',
          index: 1,
          key: 'to',
          argType: 'xAbsolute',
          expr: xArg,
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result
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
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression } = nodeMeta
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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, ...args) =>
    commonConstraintInfoHelper(
      callExp,
      ['angle', 'xAbsolute'],
      'angledLineToX',
      [
        { arrayInput: 0, objInput: 'angle' },
        { arrayInput: 1, objInput: 'to' },
      ],
      ...args
    ),
}

export const angledLineToY: SketchLineHelper = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { from, to } = segmentInput
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    if (err(nodeMeta)) return nodeMeta

    const { node: pipe } = nodeMeta

    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    const yArg = createLiteral(roundOff(to[1], 2))

    if (replaceExistingCallback) {
      const result = replaceExistingCallback([
        {
          type: 'arrayOrObjItem',
          index: 0,
          key: 'angle',
          argType: 'angle',
          expr: angle,
        },
        {
          type: 'arrayOrObjItem',
          index: 1,
          key: 'to',
          argType: 'yAbsolute',
          expr: yArg,
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result
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
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression } = nodeMeta
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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, ...args) =>
    commonConstraintInfoHelper(
      callExp,
      ['angle', 'yAbsolute'],
      'angledLineToY',
      [
        { arrayInput: 0, objInput: 'angle' },
        { arrayInput: 1, objInput: 'to' },
      ],
      ...args
    ),
}

export const angledLineThatIntersects: SketchLineHelper = {
  add: ({
    node,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
    referencedSegment,
  }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { from, to } = segmentInput
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    if (err(nodeMeta)) return nodeMeta

    const { node: pipe } = nodeMeta

    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    if (!referencedSegment) {
      return new Error('referencedSegment must be provided')
    }

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

    if (replaceExistingCallback) {
      const result = replaceExistingCallback([
        {
          type: 'objectProperty',
          key: 'angle',
          argType: 'angle',
          expr: angle,
        },
        {
          type: 'objectProperty',
          key: 'offset',
          argType: 'intersectionOffset',
          expr: offset,
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }
    return new Error('not implemented')
  },
  updateArgs: ({ node, pathToNode, input, previousProgramMemory }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression } = nodeMeta
    const angle = roundOff(getAngle(from, to), 0)

    const firstArg = callExpression.arguments?.[0]
    const intersectTag =
      firstArg.type === 'ObjectExpression'
        ? firstArg.properties.find((p) => p.key.name === 'intersectTag')
            ?.value || createLiteral('')
        : createLiteral('')
    const intersectTagName =
      intersectTag.type === 'Identifier' ? intersectTag.name : ''
    const nodeMeta2 = getNodeFromPath<VariableDeclaration>(
      _node,
      pathToNode,
      'VariableDeclaration'
    )
    if (err(nodeMeta2)) return nodeMeta2

    const { node: varDec } = nodeMeta2
    const varName = varDec.declarations[0].id.name
    const sketchGroup = sketchGroupFromKclValue(
      previousProgramMemory.get(varName),
      varName
    )
    if (err(sketchGroup)) return sketchGroup
    const intersectPath = sketchGroup.value.find(
      ({ tag }: Path) => tag && tag.value === intersectTagName
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
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp: CallExpression, code, pathToNode) => {
    if (callExp.type !== 'CallExpression') return []
    const firstArg = callExp.arguments?.[0]
    if (firstArg.type !== 'ObjectExpression') return []
    const angleIndex = firstArg.properties.findIndex(
      (p) => p.key.name === 'angle'
    )
    const offsetIndex = firstArg.properties.findIndex(
      (p) => p.key.name === 'offset'
    )
    const intersectTag = firstArg.properties.findIndex(
      (p) => p.key.name === 'intersectTag'
    )
    const returnVal = []
    const pathToObjectExp: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpression'],
      [0, 'index'],
      ['properties', 'ObjectExpression'],
    ]
    if (angleIndex !== -1) {
      const angle = firstArg.properties[angleIndex]?.value
      const pathToAngleProp: PathToNode = [
        ...pathToObjectExp,
        [angleIndex, 'index'],
        ['value', 'Property'],
      ]
      returnVal.push(
        constrainInfo(
          'angle',
          isNotLiteralArrayOrStatic(angle),
          code.slice(angle.start, angle.end),
          'angledLineThatIntersects',
          'angle',
          [angle.start, angle.end],
          pathToAngleProp
        )
      )
    }
    if (offsetIndex !== -1) {
      const offset = firstArg.properties[offsetIndex]?.value
      const pathToOffsetProp: PathToNode = [
        ...pathToObjectExp,
        [offsetIndex, 'index'],
        ['value', 'Property'],
      ]
      returnVal.push(
        constrainInfo(
          'intersectionOffset',
          isNotLiteralArrayOrStatic(offset),
          code.slice(offset.start, offset.end),
          'angledLineThatIntersects',
          'offset',
          [offset.start, offset.end],
          pathToOffsetProp
        )
      )
    }
    if (intersectTag !== -1) {
      const tag = firstArg.properties[intersectTag]?.value as Identifier
      const pathToTagProp: PathToNode = [
        ...pathToObjectExp,
        [intersectTag, 'index'],
        ['value', 'Property'],
      ]
      const info = constrainInfo(
        'intersectionTag',
        // This will always be a tag identifier.
        false,
        code.slice(tag.start, tag.end),
        'angledLineThatIntersects',
        'intersectTag',
        [tag.start, tag.end],
        pathToTagProp
      )
      returnVal.push(info)
    }
    return returnVal
  },
}

export const updateStartProfileAtArgs: SketchLineHelper['updateArgs'] = ({
  node,
  pathToNode,
  input,
}) => {
  if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
  const { to } = input
  const _node = { ...node }
  const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
  if (err(nodeMeta)) {
    console.error(nodeMeta)
    return {
      modifiedAst: {
        start: 0,
        end: 0,
        body: [],
        digest: null,
        nonCodeMeta: {
          start: [],
          nonCodeNodes: [],
          digest: null,
        },
      },
      pathToNode,
    }
  }

  const { node: callExpression } = nodeMeta
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
  circle,
} as const

export function changeSketchArguments(
  node: Program,
  programMemory: ProgramMemory,
  sourceRangeOrPath:
    | {
        type: 'sourceRange'
        sourceRange: SourceRange
      }
    | {
        type: 'path'
        pathToNode: PathToNode
      },
  input: SegmentInputs
): { modifiedAst: Program; pathToNode: PathToNode } | Error {
  const _node = { ...node }
  const thePath =
    sourceRangeOrPath.type === 'sourceRange'
      ? getNodePathFromSourceRange(_node, sourceRangeOrPath.sourceRange)
      : sourceRangeOrPath.pathToNode
  const nodeMeta = getNodeFromPath<CallExpression>(_node, thePath)
  if (err(nodeMeta)) return nodeMeta

  const { node: callExpression, shallowPath } = nodeMeta

  if (callExpression?.callee?.name in sketchLineHelperMap) {
    const { updateArgs } = sketchLineHelperMap[callExpression.callee.name]
    if (!updateArgs) {
      return new Error('not a sketch line helper')
    }

    return updateArgs({
      node: _node,
      previousProgramMemory: programMemory,
      pathToNode: shallowPath,
      input,
    })
  }

  return new Error(`not a sketch line helper: ${callExpression?.callee?.name}`)
}

export function getConstraintInfo(
  callExpression: CallExpression,
  code: string,
  pathToNode: PathToNode
): ConstrainInfo[] {
  const fnName = callExpression?.callee?.name || ''
  if (!(fnName in sketchLineHelperMap)) return []
  return sketchLineHelperMap[fnName].getConstraintInfo(
    callExpression,
    code,
    pathToNode
  )
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
  input: SegmentInputs
  fnName: ToolTip
  pathToNode: PathToNode
  spliceBetween?: boolean
}

export function addNewSketchLn({
  node: _node,
  programMemory: previousProgramMemory,
  fnName,
  pathToNode,
  input: segmentInput,
  spliceBetween = false,
}: CreateLineFnCallArgs):
  | {
      modifiedAst: Program
      pathToNode: PathToNode
    }
  | Error {
  const node = structuredClone(_node)
  const { add, updateArgs } = sketchLineHelperMap?.[fnName] || {}
  if (!add || !updateArgs) {
    return new Error('not a sketch line helper')
  }

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
    segmentInput,
    spliceBetween,
  })
}

export function addCallExpressionsToPipe({
  node,
  pathToNode,
  expressions,
}: {
  node: Program
  programMemory: ProgramMemory
  pathToNode: PathToNode
  expressions: CallExpression[]
}) {
  const _node = { ...node }
  const pipeExpression = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  if (err(pipeExpression)) return pipeExpression

  if (pipeExpression.node.type !== 'PipeExpression') {
    return new Error('not a pipe expression')
  }
  pipeExpression.node.body = [...pipeExpression.node.body, ...expressions]
  return _node
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
  )
  if (err(pipeExpression)) return pipeExpression

  if (pipeExpression.node.type !== 'PipeExpression') {
    return new Error('not a pipe expression')
  }
  pipeExpression.node.body = [...pipeExpression.node.body, closeExpression]
  return _node
}

export function replaceSketchLine({
  node,
  programMemory,
  pathToNode: _pathToNode,
  fnName,
  segmentInput,
  replaceExistingCallback,
  referencedSegment,
}: {
  node: Program
  programMemory: ProgramMemory
  pathToNode: PathToNode
  fnName: ToolTip
  segmentInput: SegmentInputs
  replaceExistingCallback: (rawArgs: RawArgs) => CreatedSketchExprResult | Error
  referencedSegment?: Path
}):
  | {
      modifiedAst: Program
      valueUsedInTransform?: number
      pathToNode: PathToNode
    }
  | Error {
  if (![...toolTips, 'intersect', 'circle'].includes(fnName)) {
    return new Error(`The following function name  is not tooltip: ${fnName}`)
  }
  const _node = { ...node }

  const { add } = sketchLineHelperMap[fnName]
  const addRetVal = add({
    node: _node,
    previousProgramMemory: programMemory,
    pathToNode: _pathToNode,
    referencedSegment,
    segmentInput,
    replaceExistingCallback,
  })
  if (err(addRetVal)) return addRetVal

  const { modifiedAst, valueUsedInTransform, pathToNode } = addRetVal
  return { modifiedAst, valueUsedInTransform, pathToNode }
}

export function addTagForSketchOnFace(
  tagInfo: AddTagInfo,
  expressionName: string
) {
  if (expressionName === 'close') {
    return addTag(1)(tagInfo)
  }
  if (expressionName in sketchLineHelperMap) {
    const { addTag } = sketchLineHelperMap[expressionName]
    return addTag(tagInfo)
  }
  return new Error(`"${expressionName}" is not a sketch line helper`)
}

export function getTagFromCallExpression(
  callExp: CallExpression
): string | Error {
  if (callExp.callee.name === 'close') return getTag(1)(callExp)
  if (callExp.callee.name in sketchLineHelperMap) {
    const { getTag } = sketchLineHelperMap[callExp.callee.name]
    return getTag(callExp)
  }
  return new Error(`"${callExp.callee.name}" is not a sketch line helper`)
}

function isAngleLiteral(lineArugement: Expr): boolean {
  return lineArugement?.type === 'ArrayExpression'
    ? isLiteralArrayOrStatic(lineArugement.elements[0])
    : lineArugement?.type === 'ObjectExpression'
    ? isLiteralArrayOrStatic(
        lineArugement.properties.find(({ key }) => key.name === 'angle')?.value
      )
    : false
}

type addTagFn = (a: AddTagInfo) => { modifiedAst: Program; tag: string } | Error

function addTag(tagIndex = 2): addTagFn {
  return ({ node, pathToNode }) => {
    const _node = { ...node }
    const callExpr = getNodeFromPath<CallExpression>(
      _node,
      pathToNode,
      'CallExpression'
    )
    if (err(callExpr)) return callExpr

    const { node: primaryCallExp } = callExpr

    // Tag is always 3rd expression now, using arg index feels brittle
    // but we can come up with a better way to identify tag later.
    const thirdArg = primaryCallExp.arguments?.[tagIndex]
    const tagDeclarator =
      thirdArg ||
      (createTagDeclarator(findUniqueName(_node, 'seg', 2)) as TagDeclarator)
    const isTagExisting = !!thirdArg
    if (!isTagExisting) {
      primaryCallExp.arguments[tagIndex] = tagDeclarator
    }
    if ('value' in tagDeclarator) {
      // Now TypeScript knows tagDeclarator has a value property
      return {
        modifiedAst: _node,
        tag: String(tagDeclarator.value),
      }
    } else {
      return new Error('Unable to assign tag without value')
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

function getFirstArgValuesForXYFns(callExpression: CallExpression):
  | {
      val: [Expr, Expr]
      tag?: Expr
    }
  | Error {
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
  return new Error('expected ArrayExpression or ObjectExpression')
}

function getFirstArgValuesForAngleFns(callExpression: CallExpression):
  | {
      val: [Expr, Expr]
      tag?: Expr
    }
  | Error {
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
  return new Error('expected ArrayExpression or ObjectExpression')
}

function getFirstArgValuesForXYLineFns(callExpression: CallExpression): {
  val: Expr
  tag?: Expr
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

const getCircle = (
  callExp: CallExpression
):
  | {
      val: [Expr, Expr, Expr]
      tag?: Expr
    }
  | Error => {
  const firstArg = callExp.arguments[0]
  if (firstArg.type === 'ObjectExpression') {
    const centerDetails = getObjExprProperty(firstArg, 'center')
    const radiusDetails = getObjExprProperty(firstArg, 'radius')
    const tag = callExp.arguments[2]
    if (centerDetails?.expr?.type === 'ArrayExpression' && radiusDetails) {
      return {
        val: [
          centerDetails?.expr.elements[0],
          centerDetails?.expr.elements[1],
          radiusDetails.expr,
        ],
        tag,
      }
    }
  }
  return new Error('expected ArrayExpression or ObjectExpression')
}
const getAngledLineThatIntersects = (
  callExp: CallExpression
):
  | {
      val: [Expr, Expr, Expr]
      tag?: Expr
    }
  | Error => {
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
  return new Error('expected ArrayExpression or ObjectExpression')
}

export function getFirstArg(callExp: CallExpression):
  | {
      val: Expr | [Expr, Expr] | [Expr, Expr, Expr]
      tag?: Expr
    }
  | Error {
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
  if (name === 'circle') {
    return getCircle(callExp)
  }
  return new Error('unexpected call expression: ' + name)
}
