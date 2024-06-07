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
} from 'lang/wasm'
import {
  getNodeFromPath,
  getNodeFromPathCurry,
  getNodePathFromSourceRange,
} from 'lang/queryAst'
import {
  LineInputsType,
  isLiteralArrayOrStatic,
  isNotLiteralArrayOrStatic,
} from 'lang/std/sketchcombos'
import { toolTips, ToolTip } from '../../useStore'
import { createPipeExpression, splitPathAtPipeExpression } from '../modifyAst'

import {
  SketchLineHelper,
  ModifyAstBase,
  TransformCallback,
  ConstrainInfo,
  RawValues,
  ArrayItemInput,
  ObjectPropertyInput,
  SingleValueInput,
  VarValueKeys,
  ArrayOrObjItemInput,
} from 'lang/std/stdTypes'

import {
  createLiteral,
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
): Value | Error {
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
  const pathToArrayExpression: PathToNode = [
    ...pathToNode,
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

function arrayRawValuesHelper(a: Array<[Literal, LineInputsType]>): RawValues {
  return a.map(
    ([literal, argType], index): ArrayItemInput<Literal> => ({
      type: 'arrayItem',
      index: index === 0 ? 0 : 1,
      argType,
      value: literal,
    })
  )
}

function arrOrObjectRawValuesHelper(
  a: Array<[Literal, LineInputsType, VarValueKeys]>
): RawValues {
  return a.map(
    ([literal, argType, key], index): ArrayOrObjItemInput<Literal> => ({
      type: 'arrayOrObjItem',
      // key: argType,w
      index: index === 0 ? 0 : 1,
      key,
      argType,
      value: literal,
    })
  )
}

function singleRawValueHelper(
  literal: Literal,
  argType: LineInputsType
): RawValues {
  return [
    {
      type: 'singleValue',
      argType,
      value: literal,
    },
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
    const nodeMeta = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    if (err(nodeMeta)) return nodeMeta
    const { node: pipe } = nodeMeta

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
        arrayRawValuesHelper([
          [createLiteral(roundOff(to[0], 2)), 'xAbsolute'],
          [createLiteral(roundOff(to[1], 2)), 'yAbsolute'],
        ]),
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
    to,
    from,
    replaceExisting,
    referencedSegment,
    createCallback,
    spliceBetween,
  }) => {
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

    if (replaceExisting && createCallback && pipe.type !== 'CallExpression') {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback(
        [newXVal, newYVal],
        arrayRawValuesHelper([
          [createLiteral(roundOff(to[0] - from[0], 2)), 'xRelative'],
          [createLiteral(roundOff(to[1] - from[1], 2)), 'yRelative'],
        ]),
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
  add: ({ node, pathToNode, to, replaceExisting, createCallback }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const _node1 = getNode<PipeExpression>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1

    const newVal = createLiteral(roundOff(to[0], 2))

    if (replaceExisting && createCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback(
        [newVal, newVal],
        singleRawValueHelper(newVal, 'xAbsolute')
      )
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
  add: ({ node, pathToNode, to, replaceExisting, createCallback }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const _node1 = getNode<PipeExpression>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1

    const newVal = createLiteral(roundOff(to[1], 2))

    if (replaceExisting && createCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback(
        [newVal, newVal],
        singleRawValueHelper(newVal, 'yAbsolute')
      )
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
  add: ({ node, pathToNode, to, from, replaceExisting, createCallback }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const _node1 = getNode<PipeExpression>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1

    const newVal = createLiteral(roundOff(to[0] - from[0], 2))
    const firstArg = newVal

    if (replaceExisting && createCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback(
        [firstArg, firstArg],
        singleRawValueHelper(firstArg, 'xRelative')
      )
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
  add: ({ node, pathToNode, to, from, replaceExisting, createCallback }) => {
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const _node1 = getNode<PipeExpression>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1
    const newVal = createLiteral(roundOff(to[1] - from[1], 2))
    if (replaceExisting && createCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback(
        [newVal, newVal],
        singleRawValueHelper(newVal, 'yRelative')
      )
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

    if (replaceExisting && createCallback && pipe.type !== 'CallExpression') {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const { callExp, valueUsedInTransform } = createCallback(
        [toX, toY],
        arrayRawValuesHelper([
          [createLiteral(roundOff(to[0], 2)), 'xAbsolute'],
          [createLiteral(roundOff(to[1], 2)), 'yAbsolute'],
        ]),
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
    const _node1 = getNode<PipeExpression>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1

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
        arrOrObjectRawValuesHelper([
          [newAngleVal, 'angle', 'angle'],
          [newLengthVal, 'length', 'length'],
        ]),
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
    to,
    from,
    createCallback,
    replaceExisting,
  }) => {
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
    const sketch = previousProgramMemory?.root?.[variableName]
    if (sketch.type !== 'SketchGroup') {
      return new Error('not a SketchGroup')
    }
    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    const xLength = createLiteral(roundOff(Math.abs(from[0] - to[0]), 2) || 0.1)
    const newLine = createCallback
      ? createCallback(
          [angle, xLength],
          arrOrObjectRawValuesHelper([
            [angle, 'angle', 'angle'],
            [xLength, 'xRelative', 'length'],
          ])
        ).callExp
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
    to,
    from,
    createCallback,
    replaceExisting,
  }) => {
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
    const sketch = previousProgramMemory?.root?.[variableName]
    if (sketch.type !== 'SketchGroup') {
      return new Error('not a SketchGroup')
    }

    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    const yLength = createLiteral(roundOff(Math.abs(from[1] - to[1]), 2) || 0.1)
    const newLine = createCallback
      ? createCallback(
          [angle, yLength],
          arrOrObjectRawValuesHelper([
            [angle, 'angle', 'angle'],
            [yLength, 'yRelative', 'length'],
          ])
        ).callExp
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
    const nodeMeta = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    if (err(nodeMeta)) return nodeMeta

    const { node: pipe } = nodeMeta
    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    const xArg = createLiteral(roundOff(to[0], 2))
    if (replaceExisting && createCallback) {
      const { callExp, valueUsedInTransform } = createCallback(
        [angle, xArg],
        arrOrObjectRawValuesHelper([
          [angle, 'angle', 'angle'],
          [xArg, 'xAbsolute', 'to'],
        ]),
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
    const nodeMeta = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    if (err(nodeMeta)) return nodeMeta

    const { node: pipe } = nodeMeta

    const angle = createLiteral(roundOff(getAngle(from, to), 0))
    const yArg = createLiteral(roundOff(to[1], 2))

    if (replaceExisting && createCallback) {
      const { callExp, valueUsedInTransform } = createCallback(
        [angle, yArg],
        arrOrObjectRawValuesHelper([
          [angle, 'angle', 'angle'],
          [yArg, 'yAbsolute', 'to'],
        ]),
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
    to,
    from,
    createCallback,
    replaceExisting,
    referencedSegment,
  }) => {
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

    if (replaceExisting && createCallback) {
      const { callExp, valueUsedInTransform } = createCallback(
        [angle, offset],
        [
          {
            type: 'objectProperty',
            key: 'angle',
            value: angle,
            argType: 'angle',
          },
          {
            type: 'objectProperty',
            key: 'offset',
            value: offset,
            argType: 'intersectionOffset',
          },
        ]
      )
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
  updateArgs: ({ node, pathToNode, to, from, previousProgramMemory }) => {
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
      intersectTag.type === 'Literal' ? intersectTag.value : ''
    const nodeMeta2 = getNodeFromPath<VariableDeclaration>(
      _node,
      pathToNode,
      'VariableDeclaration'
    )
    if (err(nodeMeta2)) return nodeMeta2

    const { node: varDec } = nodeMeta2
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
      const tag = firstArg.properties[intersectTag]?.value
      const pathToTagProp: PathToNode = [
        ...pathToObjectExp,
        [intersectTag, 'index'],
        ['value', 'Property'],
      ]
      returnVal.push(
        constrainInfo(
          'intersectionTag',
          isNotLiteralArrayOrStatic(tag),
          code.slice(tag.start, tag.end),
          'angledLineThatIntersects',
          'intersectTag',
          [tag.start, tag.end],
          pathToTagProp
        )
      )
    }
    return returnVal
  },
}

export const updateStartProfileAtArgs: SketchLineHelper['updateArgs'] = ({
  node,
  pathToNode,
  to,
}) => {
  const _node = { ...node }
  const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
  if (err(nodeMeta)) {
    console.error(nodeMeta)
    return {
      modifiedAst: {
        start: 0,
        end: 0,
        body: [],
        nonCodeMeta: {
          start: [],
          nonCodeNodes: [],
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
} as const

export function changeSketchArguments(
  node: Program,
  programMemory: ProgramMemory,
  sourceRange: SourceRange,
  args: [number, number],
  from: [number, number]
): { modifiedAst: Program; pathToNode: PathToNode } | Error {
  const _node = { ...node }
  const thePath = getNodePathFromSourceRange(_node, sourceRange)
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
      to: args,
      from,
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
}: CreateLineFnCallArgs):
  | {
      modifiedAst: Program
      pathToNode: PathToNode
    }
  | Error {
  const node = JSON.parse(JSON.stringify(_node))
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
    to,
    from,
    replaceExisting: false,
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
  to,
  from,
  createCallback,
  referencedSegment,
}: {
  node: Program
  programMemory: ProgramMemory
  pathToNode: PathToNode
  fnName: ToolTip
  to: [number, number]
  from: [number, number]
  createCallback: TransformCallback
  referencedSegment?: Path
}):
  | {
      modifiedAst: Program
      valueUsedInTransform?: number
      pathToNode: PathToNode
    }
  | Error {
  if (![...toolTips, 'intersect'].includes(fnName)) {
    return new Error('not a tooltip')
  }
  const _node = { ...node }

  const { add } = sketchLineHelperMap[fnName]
  const addRetVal = add({
    node: _node,
    previousProgramMemory: programMemory,
    pathToNode: _pathToNode,
    referencedSegment,
    to,
    from,
    replaceExisting: true,
    createCallback,
  })
  if (err(addRetVal)) return addRetVal

  const { modifiedAst, valueUsedInTransform, pathToNode } = addRetVal
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
  return new Error(`"${expressionName}" is not a sketch line helper`)
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

type addTagFn = (
  a: ModifyAstBase
) => { modifiedAst: Program; tag: string } | Error

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
      val: [Value, Value]
      tag?: Value
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
      val: [Value, Value]
      tag?: Value
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
):
  | {
      val: [Value, Value, Value]
      tag?: Value
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
      val: Value | [Value, Value] | [Value, Value, Value]
      tag?: Value
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
  return new Error('unexpected call expression: ' + name)
}
