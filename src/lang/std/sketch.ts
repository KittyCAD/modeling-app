import {
  Path,
  Sketch,
  SourceRange,
  PathToNode,
  Program,
  PipeExpression,
  CallExpression,
  CallExpressionKw,
  VariableDeclarator,
  Expr,
  VariableDeclaration,
  Identifier,
  sketchFromKclValue,
  topLevelRange,
  VariableMap,
} from 'lang/wasm'
import {
  ARG_INDEX_FIELD,
  getNodeFromPath,
  getNodeFromPathCurry,
  getObjExprProperty,
  LABELED_ARG_FIELD,
} from 'lang/queryAst'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import {
  isLiteralArrayOrStatic,
  isNotLiteralArrayOrStatic,
} from 'lang/std/sketchcombos'
import { toolTips, ToolTip } from 'lang/langHelpers'
import {
  createPipeExpression,
  mutateKwArg,
  nonCodeMetaEmpty,
  removeKwArgs,
  splitPathAtPipeExpression,
} from '../modifyAst'

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
  SketchLineHelperKw,
  InputArgKeys,
} from 'lang/std/stdTypes'

import {
  createLiteral,
  createTagDeclarator,
  createCallExpression,
  createCallExpressionStdLibKw,
  createArrayExpression,
  createLabeledArg,
  createPipeSubstitution,
  createObjectExpression,
  mutateArrExp,
  mutateObjExpProp,
  findUniqueName,
} from 'lang/modifyAst'
import { roundOff, getLength, getAngle, isArray } from 'lib/utils'
import { err } from 'lib/trap'
import { perpendicularDistance } from 'sketch-helpers'
import { TagDeclarator } from '@rust/kcl-lib/bindings/TagDeclarator'
import { EdgeCutInfo } from 'machines/modelingMachine'
import { Node } from '@rust/kcl-lib/bindings/Node'
import {
  findKwArg,
  findKwArgWithIndex,
  findKwArgAny,
  findKwArgAnyIndex,
} from 'lang/util'

export const ARG_TAG = 'tag'
export const ARG_END = 'end'
export const ARG_LENGTH = 'length'
export const ARG_END_ABSOLUTE = 'endAbsolute'
export const ARG_CIRCLE_CENTER = 'center'
export const ARG_CIRCLE_RADIUS = 'radius'
export const DETERMINING_ARGS = [ARG_LENGTH, ARG_END, ARG_END_ABSOLUTE]

const STRAIGHT_SEGMENT_ERR = new Error(
  'Invalid input, expected "straight-segment"'
)
const ARC_SEGMENT_ERR = new Error('Invalid input, expected "arc-segment"')
const CIRCLE_THREE_POINT_SEGMENT_ERR = new Error(
  'Invalid input, expected "circle-three-point-segment"'
)

export type Coords2d = [number, number]

export function getCoordsFromPaths(skGroup: Sketch, index = 0): Coords2d {
  const currentPath = skGroup?.paths?.[index]
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
  if (isArray(val)) {
    if (
      [
        'angledLine',
        'angledLineOfXLength',
        'angledLineOfYLength',
        'angledLineToX',
        'angledLineToY',
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
    if (['xLine', 'xLineTo', 'yLine', 'yLineTo'].includes(sketchFn)) return val
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
  callExp: CallExpression | CallExpressionKw,
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
  pathToNode: PathToNode,
  filterValue?: string
) => {
  if (callExp.type !== 'CallExpression' && callExp.type !== 'CallExpressionKw')
    return []
  const firstArg = (() => {
    switch (callExp.type) {
      case 'CallExpression':
        return callExp.arguments[0]
      case 'CallExpressionKw':
        return findKwArgAny(DETERMINING_ARGS, callExp)
    }
  })()
  if (firstArg === undefined) {
    return []
  }
  const isArr = firstArg.type === 'ArrayExpression'
  if (!isArr && firstArg.type !== 'ObjectExpression') return []
  const pipeExpressionIndex = pathToNode.findIndex(
    ([_, nodeName]) => nodeName === 'PipeExpression'
  )
  const pathToBase = pathToNode.slice(0, pipeExpressionIndex + 2)
  const argIndex = (() => {
    switch (callExp.type) {
      case 'CallExpression':
        return 0
      case 'CallExpressionKw':
        return findKwArgAnyIndex(DETERMINING_ARGS, callExp)
    }
  })()
  if (argIndex === undefined) {
    return []
  }

  // Construct the pathToNode.
  const pathToArrayExpression: PathToNode = (() => {
    const isKw = callExp.type === 'CallExpressionKw'
    let path: PathToNode = [
      ...pathToBase,
      ['arguments', callExp.type],
      [argIndex, 'index'],
    ]
    if (isKw) {
      path.push(['arg', LABELED_ARG_FIELD])
    }
    path.push(
      isArr
        ? ['elements', 'ArrayExpression']
        : ['properties', 'ObjectExpression']
    )
    return path
  })()

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
        topLevelRange(input1.start, input1.end),
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
        topLevelRange(input2.start, input2.end),
        pathToSecondArg
      )
    )

  return constraints
}

const horzVertConstraintInfoHelper = (
  callExp: CallExpressionKw,
  inputConstrainTypes: [ConstrainInfo['type'], ConstrainInfo['type']],
  stdLibFnName: ConstrainInfo['stdLibFnName'],
  abbreviatedInput: AbbreviatedInput,
  code: string,
  pathToNode: PathToNode,
  filterValue?: string
) => {
  if (callExp.type !== 'CallExpressionKw') return []
  const argIndex = findKwArgAnyIndex(DETERMINING_ARGS, callExp)
  if (argIndex === undefined) {
    return []
  }
  const firstArg = callExp.arguments?.[argIndex].arg
  const callee = callExp.callee
  const pathToFirstArg: PathToNode = [
    ...pathToNode,
    ['arguments', 'CallExpressionKw'],
    [argIndex, ARG_INDEX_FIELD],
    ['arg', LABELED_ARG_FIELD],
  ]
  const pathToCallee: PathToNode = [...pathToNode, ['callee', 'CallExpression']]
  return [
    constrainInfo(
      inputConstrainTypes[0],
      true,
      callee.name,
      stdLibFnName,
      undefined,
      topLevelRange(callee.start, callee.end),
      pathToCallee
    ),
    constrainInfo(
      inputConstrainTypes[1],
      isNotLiteralArrayOrStatic(firstArg),
      code.slice(firstArg.start, firstArg.end),
      stdLibFnName,
      abbreviatedInput,
      topLevelRange(firstArg.start, firstArg.end),
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

function getTagKwArg(): SketchLineHelperKw['getTag'] {
  return (callExp: CallExpressionKw) => {
    if (callExp.type !== 'CallExpressionKw')
      return new Error('Not a CallExpressionKw')
    const arg = findKwArg(ARG_TAG, callExp)
    if (!arg) return new Error('No argument')
    if (arg.type !== 'TagDeclarator')
      return new Error('Tag not a TagDeclarator')
    return arg.value
  }
}

export const line: SketchLineHelperKw = {
  add: ({
    node,
    variables,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
    spliceBetween,
  }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { from, to } = segmentInput
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<PipeExpression | CallExpressionKw>(
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
      const callExp = createCallExpressionStdLibKw(
        'line',
        null, // Assumes this is being called in a pipeline, so the first arg is optional and if not given, will become pipeline substitution.
        // TODO: ADAM: This should have a tag sometimes.
        [createLabeledArg(ARG_END, createArrayExpression([newXVal, newYVal]))]
      )
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

    if (replaceExistingCallback && pipe.type !== 'CallExpressionKw') {
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

    const callExp = createCallExpressionStdLibKw(
      'line',
      null, // Assumes this is being called in a pipeline, so the first arg is optional and if not given, will become pipeline substitution.
      [createLabeledArg(ARG_END, createArrayExpression([newXVal, newYVal]))]
    )
    if (pipe.type === 'PipeExpression') {
      pipe.body = [...pipe.body, callExp]
      return {
        modifiedAst: _node,
        pathToNode: [
          ...pathToNode,
          ['body', 'PipeExpression'],
          [pipe.body.length - 1, 'CallExpressionKw'],
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
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta

    const toArrExp = createArrayExpression([
      createLiteral(roundOff(to[0] - from[0], 2)),
      createLiteral(roundOff(to[1] - from[1], 2)),
    ])

    mutateKwArg(ARG_END, callExpression, toArrExp)
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp, ...args) =>
    commonConstraintInfoHelper(
      callExp,
      ['xRelative', 'yRelative'],
      'line',
      [{ arrayInput: 0 }, { arrayInput: 1 }],
      ...args
    ),
}

export const lineTo: SketchLineHelperKw = {
  add: ({
    node,
    variables,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
    spliceBetween,
  }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const to = segmentInput.to
    const _node = structuredClone(node)
    const nodeMeta = getNodeFromPath<PipeExpression | CallExpressionKw>(
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

    const newXVal = createLiteral(roundOff(to[0], 2))
    const newYVal = createLiteral(roundOff(to[1], 2))

    if (
      spliceBetween &&
      !replaceExistingCallback &&
      pipe.type === 'PipeExpression'
    ) {
      const callExp = createCallExpressionStdLibKw(
        'line',
        null, // Assumes this is being called in a pipeline, so the first arg is optional and if not given, will become pipeline substitution.
        [
          createLabeledArg(
            ARG_END_ABSOLUTE,
            createArrayExpression([newXVal, newYVal])
          ),
        ]
      )
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

    if (replaceExistingCallback && pipe.type !== 'CallExpressionKw') {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const result = replaceExistingCallback([
        {
          type: 'arrayItem',
          index: 0,
          argType: 'xRelative',
          expr: newXVal,
        },
        {
          type: 'arrayItem',
          index: 1,
          argType: 'yRelative',
          expr: newYVal,
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

    const callExp = createCallExpressionStdLibKw(
      'line',
      null, // Assumes this is being called in a pipeline, so the first arg is optional and if not given, will become pipeline substitution.
      [
        createLabeledArg(
          ARG_END_ABSOLUTE,
          createArrayExpression([newXVal, newYVal])
        ),
      ]
    )
    if (pipe.type === 'PipeExpression') {
      pipe.body = [...pipe.body, callExp]
      return {
        modifiedAst: _node,
        pathToNode: [
          ...pathToNode,
          ['body', 'PipeExpression'],
          [pipe.body.length - 1, 'CallExpressionKw'],
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
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta

    const toArrExp = createArrayExpression([
      createLiteral(roundOff(to[0], 2)),
      createLiteral(roundOff(to[1], 2)),
    ])

    mutateKwArg(ARG_END_ABSOLUTE, callExpression, toArrExp)
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp, ...args) =>
    commonConstraintInfoHelper(
      callExp,
      ['xAbsolute', 'yAbsolute'],
      'line',
      [{ arrayInput: 0 }, { arrayInput: 1 }],
      ...args
    ),
}

export const xLineTo: SketchLineHelperKw = {
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
    const callExp = createCallExpressionStdLibKw('xLine', null, [
      createLabeledArg(ARG_END_ABSOLUTE, newVal),
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
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
    const newX = createLiteral(roundOff(to[0], 2))
    removeDeterminingArgs(callExpression)
    mutateKwArg(ARG_END_ABSOLUTE, callExpression, newX)
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp, ...args) =>
    horzVertConstraintInfoHelper(
      callExp,
      ['horizontal', 'xAbsolute'],
      'xLineTo',
      'singleValue',
      ...args
    ),
}

export const yLineTo: SketchLineHelperKw = {
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
    const callExp = createCallExpressionStdLibKw('yLine', null, [
      createLabeledArg(ARG_END_ABSOLUTE, newVal),
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
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
    const newY = createLiteral(roundOff(to[1], 2))
    removeDeterminingArgs(callExpression)
    mutateKwArg(ARG_END_ABSOLUTE, callExpression, newY)
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp, ...args) =>
    horzVertConstraintInfoHelper(
      callExp,
      ['vertical', 'yAbsolute'],
      'yLineTo',
      'singleValue',
      ...args
    ),
}

export const xLine: SketchLineHelperKw = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { from, to } = segmentInput
    const _node = structuredClone(node)
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const varDec = getNode<VariableDeclaration>('VariableDeclaration')
    if (err(varDec)) return varDec
    const dec = varDec.node.declaration

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
      if (dec.init.type === 'PipeExpression') {
        dec.init.body[callIndex] = callExp
      } else {
        dec.init = callExp
      }
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }

    const newLine = createCallExpressionStdLibKw('xLine', null, [
      createLabeledArg(ARG_LENGTH, newVal),
    ])
    if (dec.init.type === 'PipeExpression') {
      dec.init.body = [...dec.init.body, newLine]
    } else {
      dec.init = createPipeExpression([dec.init, newLine])
    }
    return { modifiedAst: _node, pathToNode }
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
    const newX = createLiteral(roundOff(to[0] - from[0], 2))
    removeDeterminingArgs(callExpression)
    mutateKwArg(ARG_LENGTH, callExpression, newX)
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp, ...args) =>
    horzVertConstraintInfoHelper(
      callExp,
      ['horizontal', 'xRelative'],
      'xLine',
      'singleValue',
      ...args
    ),
}

export const yLine: SketchLineHelperKw = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { from, to } = segmentInput
    const _node = structuredClone(node)
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const varDec = getNode<VariableDeclaration>('VariableDeclaration')
    if (err(varDec)) return varDec
    const dec = varDec.node.declaration
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
      if (dec.init.type === 'PipeExpression') {
        dec.init.body[callIndex] = callExp
      } else {
        dec.init = callExp
      }
      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }

    const newLine = createCallExpressionStdLibKw('yLine', null, [
      createLabeledArg(ARG_LENGTH, newVal),
    ])
    if (dec.init.type === 'PipeExpression') {
      dec.init.body = [...dec.init.body, newLine]
    } else {
      dec.init = createPipeExpression([dec.init, newLine])
    }
    return { modifiedAst: _node, pathToNode }
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
    const newY = createLiteral(roundOff(to[1] - from[1], 2))
    removeDeterminingArgs(callExpression)
    mutateKwArg(ARG_LENGTH, callExpression, newY)
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
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
          ...pathToNode.slice(
            0,
            pathToNode.findIndex(([_, type]) => type === 'PipeExpression') + 1
          ),
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
        topLevelRange(callee.start, callee.end),
        pathToCallee
      ),
      constrainInfo(
        'xAbsolute',
        isNotLiteralArrayOrStatic(firstArg.elements[0]),
        code.slice(firstArg.elements[0].start, firstArg.elements[0].end),
        'tangentialArcTo',
        0,
        topLevelRange(firstArg.elements[0].start, firstArg.elements[0].end),
        pathToFirstArg
      ),
      constrainInfo(
        'yAbsolute',
        isNotLiteralArrayOrStatic(firstArg.elements[1]),
        code.slice(firstArg.elements[1].start, firstArg.elements[1].end),
        'tangentialArcTo',
        1,
        topLevelRange(firstArg.elements[1].start, firstArg.elements[1].end),
        pathToSecondArg
      ),
    ]
  },
}
export const circle: SketchLineHelperKw = {
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
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression } = nodeMeta

    const newCenter = createArrayExpression([
      createLiteral(roundOff(center[0])),
      createLiteral(roundOff(center[1])),
    ])
    mutateKwArg(ARG_CIRCLE_CENTER, callExpression, newCenter)
    const newRadius = createLiteral(roundOff(radius))
    mutateKwArg(ARG_CIRCLE_RADIUS, callExpression, newRadius)
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp: CallExpressionKw, code, pathToNode) => {
    if (callExp.type !== 'CallExpressionKw') return []
    const firstArg = callExp.arguments?.[0]
    if (firstArg.type !== 'LabeledArg') return []
    let centerInfo = findKwArgWithIndex(ARG_CIRCLE_CENTER, callExp)
    let radiusInfo = findKwArgWithIndex(ARG_CIRCLE_RADIUS, callExp)
    if (!centerInfo || !radiusInfo) return []
    if (centerInfo?.expr.type !== 'ArrayExpression') return []

    const pathToCenterArrayExpression: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpressionKw'],
      [centerInfo.argIndex, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
    ]
    const pathToRadiusLiteral: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpressionKw'],
      [radiusInfo.argIndex, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
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
        isNotLiteralArrayOrStatic(radiusInfo.expr),
        code.slice(radiusInfo.expr.start, radiusInfo.expr.end),
        'circle',
        'radius',
        topLevelRange(radiusInfo.expr.start, radiusInfo.expr.end),
        pathToRadiusLiteral
      ),
      {
        stdLibFnName: 'circle',
        type: 'xAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(centerInfo.expr.elements[0]),
        sourceRange: topLevelRange(
          centerInfo.expr.elements[0].start,
          centerInfo.expr.elements[0].end
        ),
        pathToNode: pathToXArg,
        value: code.slice(
          centerInfo.expr.elements[0].start,
          centerInfo.expr.elements[0].end
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
        isConstrained: isNotLiteralArrayOrStatic(centerInfo.expr.elements[1]),
        sourceRange: topLevelRange(
          centerInfo.expr.elements[1].start,
          centerInfo.expr.elements[1].end
        ),
        pathToNode: pathToYArg,
        value: code.slice(
          centerInfo.expr.elements[1].start,
          centerInfo.expr.elements[1].end
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

export const arc: SketchLineHelper = {
  add: ({
    node,
    variables,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
    spliceBetween,
  }) => {
    if (segmentInput.type !== 'arc-segment') return ARC_SEGMENT_ERR
    const { center, radius, from, to } = segmentInput
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

    // Calculate start angle (from center to 'from' point)
    const startAngle = Math.atan2(from[1] - center[1], from[0] - center[0])

    // Calculate end angle (from center to 'to' point)
    const endAngle = Math.atan2(to[1] - center[1], to[0] - center[0])

    // Create literals for the angles (convert to degrees)
    const startAngleDegrees = (startAngle * 180) / Math.PI
    const endAngleDegrees = (endAngle * 180) / Math.PI

    // Create the arc call expression
    const arcObj = createObjectExpression({
      radius: createLiteral(roundOff(radius)),
      angleStart: createLiteral(roundOff(startAngleDegrees)),
      angleEnd: createLiteral(roundOff(endAngleDegrees)),
    })

    const newArc = createCallExpression('arc', [
      arcObj,
      createPipeSubstitution(),
    ])

    if (
      spliceBetween &&
      !replaceExistingCallback &&
      pipe.type === 'PipeExpression'
    ) {
      const pathToNodeIndex = pathToNode.findIndex(
        (x) => x[1] === 'PipeExpression'
      )
      const pipeIndex = pathToNode[pathToNodeIndex + 1][0]
      if (typeof pipeIndex === 'undefined' || typeof pipeIndex === 'string') {
        return new Error('pipeIndex is undefined')
      }
      pipe.body = [
        ...pipe.body.slice(0, pipeIndex),
        newArc,
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
          type: 'objectProperty',
          key: 'center',
          argType: 'xRelative',
          expr: createLiteral(roundOff(center[0])),
        },
        {
          type: 'objectProperty',
          key: 'center',
          argType: 'yRelative',
          expr: createLiteral(roundOff(center[1])),
        },
        {
          type: 'objectProperty',
          key: 'radius',
          argType: 'radius',
          expr: createLiteral(roundOff(radius)),
        },
        {
          type: 'objectProperty',
          key: 'angle',
          argType: 'angle',
          expr: createLiteral(roundOff(startAngleDegrees)),
        },
        {
          type: 'objectProperty',
          key: 'angle',
          argType: 'angle',
          expr: createLiteral(roundOff(endAngleDegrees)),
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result
      pipe.body[callIndex] = callExp
      return {
        modifiedAst: _node,
        pathToNode: [
          ...pathToNode.slice(
            0,
            pathToNode.findIndex(([_, type]) => type === 'PipeExpression') + 1
          ),
          [pipe.body.length - 1, 'CallExpression'],
        ],
        valueUsedInTransform,
      }
    }

    if (pipe.type === 'PipeExpression') {
      pipe.body = [...pipe.body, newArc]
      return {
        modifiedAst: _node,
        pathToNode: [
          ...pathToNode.slice(
            0,
            pathToNode.findIndex(([_, type]) => type === 'PipeExpression') + 1
          ),
          [pipe.body.length - 1, 'CallExpression'],
        ],
      }
    } else {
      varDec.init = createPipeExpression([varDec.init, newArc])
    }

    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'arc-segment') return ARC_SEGMENT_ERR
    const { center, radius, from, to } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression, shallowPath } = nodeMeta
    const firstArg = callExpression.arguments?.[0]

    if (firstArg.type !== 'ObjectExpression') {
      return new Error('Expected object expression as first argument')
    }

    // Calculate start angle (from center to 'from' point)
    const startAngle = Math.atan2(from[1] - center[1], from[0] - center[0])

    // Calculate end angle (from center to 'to' point)
    const endAngle = Math.atan2(to[1] - center[1], to[0] - center[0])

    // Create literals for the angles (convert to degrees)
    const startAngleDegrees = (startAngle * 180) / Math.PI
    const endAngleDegrees = (endAngle * 180) / Math.PI

    // Update radius
    const newRadius = createLiteral(roundOff(radius))
    mutateObjExpProp(firstArg, newRadius, 'radius')

    // Update angleStart
    const newAngleStart = createLiteral(roundOff(startAngleDegrees))
    mutateObjExpProp(firstArg, newAngleStart, 'angleStart')

    // Update angleEnd
    const newAngleEnd = createLiteral(roundOff(endAngleDegrees))
    mutateObjExpProp(firstArg, newAngleEnd, 'angleEnd')

    return {
      modifiedAst: _node,
      pathToNode: shallowPath,
    }
  },
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, code, pathToNode) => {
    return []
  },
}
export const arcTo: SketchLineHelper = {
  add: ({
    node,
    variables,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
    spliceBetween,
  }) => {
    if (segmentInput.type !== 'circle-three-point-segment')
      return ARC_SEGMENT_ERR

    const { p2, p3 } = segmentInput
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )
    if (err(nodeMeta)) return nodeMeta

    const { node: pipe } = nodeMeta

    // p1 is the start point (from the previous segment)
    // p2 is the interior point
    // p3 is the end point
    const interior = createArrayExpression([
      createLiteral(roundOff(p2[0], 2)),
      createLiteral(roundOff(p2[1], 2)),
    ])

    const end = createArrayExpression([
      createLiteral(roundOff(p3[0], 2)),
      createLiteral(roundOff(p3[1], 2)),
    ])

    if (replaceExistingCallback) {
      const result = replaceExistingCallback([
        {
          type: 'objectProperty',
          key: 'interior' as InputArgKeys,
          argType: 'xAbsolute',
          expr: createLiteral(0) as any, // This is a workaround, the actual value will be set later
        },
        {
          type: 'objectProperty',
          key: 'end' as InputArgKeys,
          argType: 'yAbsolute',
          expr: createLiteral(0) as any, // This is a workaround, the actual value will be set later
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result

      // Now manually update the object properties
      if (
        callExp.type === 'CallExpression' &&
        callExp.arguments[0]?.type === 'ObjectExpression'
      ) {
        const objExp = callExp.arguments[0]
        const interiorProp = objExp.properties.find(
          (p) =>
            p.type === 'ObjectProperty' &&
            p.key.type === 'Identifier' &&
            p.key.name === 'interior'
        )
        const endProp = objExp.properties.find(
          (p) =>
            p.type === 'ObjectProperty' &&
            p.key.type === 'Identifier' &&
            p.key.name === 'end'
        )

        if (interiorProp && interiorProp.type === 'ObjectProperty') {
          interiorProp.value = interior
        }
        if (endProp && endProp.type === 'ObjectProperty') {
          endProp.value = end
        }
      }

      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      pipe.body[callIndex] = callExp

      return {
        modifiedAst: _node,
        pathToNode: [
          ...pathToNode.slice(
            0,
            pathToNode.findIndex(([_, type]) => type === 'PipeExpression') + 1
          ),
          [pipe.body.length - 1, 'CallExpression'],
        ],
        valueUsedInTransform,
      }
    }

    const objExp = createObjectExpression({
      interior,
      end,
    })

    const newLine = createCallExpression('arcTo', [
      objExp,
      createPipeSubstitution(),
    ])

    if (spliceBetween) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      pipe.body.splice(callIndex + 1, 0, newLine)
    } else {
      pipe.body.push(newLine)
    }

    return {
      modifiedAst: _node,
      pathToNode: [
        ...pathToNode.slice(
          0,
          pathToNode.findIndex(([_, type]) => type === 'PipeExpression') + 1
        ),
        [pipe.body.length - 1, 'CallExpression'],
      ],
    }
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'circle-three-point-segment') return ARC_SEGMENT_ERR

    const { p1, p2, p3 } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpression>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression } = nodeMeta

    // Update the first argument which should be an object with interior and end properties
    const firstArg = callExpression.arguments?.[0]
    if (!firstArg) return new Error('Missing first argument in arcTo')

    const interiorPoint = createArrayExpression([
      createLiteral(roundOff(p2[0], 2)),
      createLiteral(roundOff(p2[1], 2)),
    ])

    const endPoint = createArrayExpression([
      createLiteral(roundOff(p3[0], 2)),
      createLiteral(roundOff(p3[1], 2)),
    ])

    mutateObjExpProp(firstArg, interiorPoint, 'interior')
    mutateObjExpProp(firstArg, endPoint, 'end')

    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getTag: getTag(),
  addTag: addTag(),
  getConstraintInfo: (callExp, code, pathToNode) => {
    if (callExp.type !== 'CallExpression') return []
    const args = callExp.arguments
    if (args.length < 1) return []

    const firstArg = args[0]
    if (firstArg.type !== 'ObjectExpression') return []

    // Find interior and end properties
    const interiorProp = firstArg.properties.find(
      (prop) =>
        prop.type === 'ObjectProperty' &&
        prop.key.type === 'Identifier' &&
        prop.key.name === 'interior'
    )

    const endProp = firstArg.properties.find(
      (prop) =>
        prop.type === 'ObjectProperty' &&
        prop.key.type === 'Identifier' &&
        prop.key.name === 'end'
    )

    if (!interiorProp || !endProp) return []
    if (
      interiorProp.value.type !== 'ArrayExpression' ||
      endProp.value.type !== 'ArrayExpression'
    )
      return []

    const interiorArr = interiorProp.value
    const endArr = endProp.value

    if (interiorArr.elements.length < 2 || endArr.elements.length < 2) return []

    const pathToFirstArg: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpression'],
      [0, 'index'],
    ]

    const pathToInteriorProp: PathToNode = [
      ...pathToFirstArg,
      ['properties', 'ObjectExpression'],
      [firstArg.properties.indexOf(interiorProp), 'index'],
    ]

    const pathToEndProp: PathToNode = [
      ...pathToFirstArg,
      ['properties', 'ObjectExpression'],
      [firstArg.properties.indexOf(endProp), 'index'],
    ]

    const pathToInteriorValue: PathToNode = [
      ...pathToInteriorProp,
      ['value', 'ObjectProperty'],
    ]

    const pathToEndValue: PathToNode = [
      ...pathToEndProp,
      ['value', 'ObjectProperty'],
    ]

    const pathToInteriorX: PathToNode = [
      ...pathToInteriorValue,
      ['elements', 'ArrayExpression'],
      [0, 'index'],
    ]

    const pathToInteriorY: PathToNode = [
      ...pathToInteriorValue,
      ['elements', 'ArrayExpression'],
      [1, 'index'],
    ]

    const pathToEndX: PathToNode = [
      ...pathToEndValue,
      ['elements', 'ArrayExpression'],
      [0, 'index'],
    ]

    const pathToEndY: PathToNode = [
      ...pathToEndValue,
      ['elements', 'ArrayExpression'],
      [1, 'index'],
    ]

    return [
      constrainInfo(
        'xAbsolute',
        isNotLiteralArrayOrStatic(interiorArr.elements[0]),
        code.slice(interiorArr.elements[0].start, interiorArr.elements[0].end),
        'arcTo' as ToolTip,
        0 as AbbreviatedInput,
        topLevelRange(
          interiorArr.elements[0].start,
          interiorArr.elements[0].end
        ),
        pathToInteriorX
      ),
      constrainInfo(
        'yAbsolute',
        isNotLiteralArrayOrStatic(interiorArr.elements[1]),
        code.slice(interiorArr.elements[1].start, interiorArr.elements[1].end),
        'arcTo' as ToolTip,
        1 as AbbreviatedInput,
        topLevelRange(
          interiorArr.elements[1].start,
          interiorArr.elements[1].end
        ),
        pathToInteriorY
      ),
      constrainInfo(
        'xAbsolute',
        isNotLiteralArrayOrStatic(endArr.elements[0]),
        code.slice(endArr.elements[0].start, endArr.elements[0].end),
        'arcTo' as ToolTip,
        2 as AbbreviatedInput,
        topLevelRange(endArr.elements[0].start, endArr.elements[0].end),
        pathToEndX
      ),
      constrainInfo(
        'yAbsolute',
        isNotLiteralArrayOrStatic(endArr.elements[1]),
        code.slice(endArr.elements[1].start, endArr.elements[1].end),
        'arcTo' as ToolTip,
        3 as AbbreviatedInput,
        topLevelRange(endArr.elements[1].start, endArr.elements[1].end),
        pathToEndY
      ),
    ]
  },
}

export const circleThreePoint: SketchLineHelperKw = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'circle-three-point-segment') {
      return CIRCLE_THREE_POINT_SEGMENT_ERR
    }

    const { p1, p2, p3 } = segmentInput
    const _node = structuredClone(node)
    const nodeMeta = getNodeFromPath<VariableDeclaration>(
      _node,
      pathToNode,
      'VariableDeclaration'
    )
    if (err(nodeMeta)) return nodeMeta

    const { node: varDec } = nodeMeta

    const createRoundedLiteral = (val: number) =>
      createLiteral(roundOff(val, 2))
    if (replaceExistingCallback) {
      const result = replaceExistingCallback([
        {
          type: 'arrayInObject',
          index: 0,
          key: 'p1',
          argType: 'xAbsolute',
          expr: createRoundedLiteral(p1[0]),
        },
        {
          type: 'arrayInObject',
          index: 1,
          key: 'p1',
          argType: 'yAbsolute',
          expr: createRoundedLiteral(p1[1]),
        },
        {
          type: 'arrayInObject',
          index: 0,
          key: 'p2',
          argType: 'xAbsolute',
          expr: createRoundedLiteral(p2[0]),
        },
        {
          type: 'arrayInObject',
          index: 1,
          key: 'p2',
          argType: 'yAbsolute',
          expr: createRoundedLiteral(p2[1]),
        },
        {
          type: 'arrayInObject',
          index: 0,
          key: 'p3',
          argType: 'xAbsolute',
          expr: createRoundedLiteral(p3[0]),
        },
        {
          type: 'arrayInObject',
          index: 1,
          key: 'p3',
          argType: 'yAbsolute',
          expr: createRoundedLiteral(p3[1]),
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result

      varDec.declaration.init = callExp

      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    }
    return new Error('replaceExistingCallback is missing')
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'circle-three-point-segment') {
      return CIRCLE_THREE_POINT_SEGMENT_ERR
    }
    const { p1, p2, p3 } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression, shallowPath } = nodeMeta
    const createRounded2DPointArr = (point: [number, number]) =>
      createArrayExpression([
        createLiteral(roundOff(point[0], 2)),
        createLiteral(roundOff(point[1], 2)),
      ])

    const newP1 = createRounded2DPointArr(p1)
    const newP2 = createRounded2DPointArr(p2)
    const newP3 = createRounded2DPointArr(p3)
    mutateKwArg('p1', callExpression, newP1)
    mutateKwArg('p2', callExpression, newP2)
    mutateKwArg('p3', callExpression, newP3)

    return {
      modifiedAst: _node,
      pathToNode: shallowPath,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp, code, pathToNode, filterValue) => {
    if (callExp.type !== 'CallExpressionKw') return []
    const p1Details = findKwArgWithIndex('p1', callExp)
    const p2Details = findKwArgWithIndex('p2', callExp)
    const p3Details = findKwArgWithIndex('p3', callExp)
    if (!p1Details || !p2Details || !p3Details) return []
    if (
      p1Details.expr.type !== 'ArrayExpression' ||
      p2Details.expr.type !== 'ArrayExpression' ||
      p3Details.expr.type !== 'ArrayExpression'
    )
      return []

    const pathToP1ArrayExpression: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpressionKw'],
      [p1Details.argIndex, 'arg index'],
      ['arg', 'labeledArg -> Arg'],
      ['elements', 'ArrayExpression'],
    ]
    const pathToP2ArrayExpression: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpressionKw'],
      [p2Details.argIndex, 'arg index'],
      ['arg', 'labeledArg -> Arg'],
      ['elements', 'ArrayExpression'],
    ]
    const pathToP3ArrayExpression: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpressionKw'],
      [p3Details.argIndex, 'arg index'],
      ['arg', 'labeledArg -> Arg'],
      ['elements', 'ArrayExpression'],
    ]

    const pathToP1XArg: PathToNode = [...pathToP1ArrayExpression, [0, 'index']]
    const pathToP1YArg: PathToNode = [...pathToP1ArrayExpression, [1, 'index']]
    const pathToP2XArg: PathToNode = [...pathToP2ArrayExpression, [0, 'index']]
    const pathToP2YArg: PathToNode = [...pathToP2ArrayExpression, [1, 'index']]
    const pathToP3XArg: PathToNode = [...pathToP3ArrayExpression, [0, 'index']]
    const pathToP3YArg: PathToNode = [...pathToP3ArrayExpression, [1, 'index']]

    const constraints: (ConstrainInfo & { filterValue: string })[] = [
      {
        stdLibFnName: 'circleThreePoint',
        type: 'xAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(p1Details.expr.elements[0]),
        sourceRange: [
          p1Details.expr.elements[0].start,
          p1Details.expr.elements[0].end,
          0,
        ],
        pathToNode: pathToP1XArg,
        value: code.slice(
          p1Details.expr.elements[0].start,
          p1Details.expr.elements[0].end
        ),
        argPosition: {
          type: 'arrayInObject',
          index: 0,
          key: 'p1',
        },
        filterValue: 'p1',
      },
      {
        stdLibFnName: 'circleThreePoint',
        type: 'yAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(p1Details.expr.elements[1]),
        sourceRange: [
          p1Details.expr.elements[1].start,
          p1Details.expr.elements[1].end,
          0,
        ],
        pathToNode: pathToP1YArg,
        value: code.slice(
          p1Details.expr.elements[1].start,
          p1Details.expr.elements[1].end
        ),
        argPosition: {
          type: 'arrayInObject',
          index: 1,
          key: 'p1',
        },
        filterValue: 'p1',
      },
      {
        stdLibFnName: 'circleThreePoint',
        type: 'xAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(p2Details.expr.elements[0]),
        sourceRange: [
          p2Details.expr.elements[0].start,
          p2Details.expr.elements[0].end,
          0,
        ],
        pathToNode: pathToP2XArg,
        value: code.slice(
          p2Details.expr.elements[0].start,
          p2Details.expr.elements[0].end
        ),
        argPosition: {
          type: 'arrayInObject',
          index: 0,
          key: 'p2',
        },
        filterValue: 'p2',
      },
      {
        stdLibFnName: 'circleThreePoint',
        type: 'yAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(p2Details.expr.elements[1]),
        sourceRange: [
          p2Details.expr.elements[1].start,
          p2Details.expr.elements[1].end,
          0,
        ],
        pathToNode: pathToP2YArg,
        value: code.slice(
          p2Details.expr.elements[1].start,
          p2Details.expr.elements[1].end
        ),
        argPosition: {
          type: 'arrayInObject',
          index: 1,
          key: 'p2',
        },
        filterValue: 'p2',
      },
      {
        stdLibFnName: 'circleThreePoint',
        type: 'xAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(p3Details.expr.elements[0]),
        sourceRange: [
          p3Details.expr.elements[0].start,
          p3Details.expr.elements[0].end,
          0,
        ],
        pathToNode: pathToP3XArg,
        value: code.slice(
          p3Details.expr.elements[0].start,
          p3Details.expr.elements[0].end
        ),
        argPosition: {
          type: 'arrayInObject',
          index: 0,
          key: 'p3',
        },
        filterValue: 'p3',
      },
      {
        stdLibFnName: 'circleThreePoint',
        type: 'yAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(p3Details.expr.elements[1]),
        sourceRange: [
          p3Details.expr.elements[1].start,
          p3Details.expr.elements[1].end,
          0,
        ],
        pathToNode: pathToP3YArg,
        value: code.slice(
          p3Details.expr.elements[1].start,
          p3Details.expr.elements[1].end
        ),
        argPosition: {
          type: 'arrayInObject',
          index: 1,
          key: 'p3',
        },
        filterValue: 'p3',
      },
    ]
    const finalConstraints: ConstrainInfo[] = []
    constraints.forEach((constraint) => {
      if (!filterValue) {
        finalConstraints.push(constraint)
      }
      if (filterValue && constraint.filterValue === filterValue) {
        finalConstraints.push(constraint)
      }
    })
    return finalConstraints
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
    variables,
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
    const sketch = sketchFromKclValue(variables[variableName], variableName)
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
    variables,
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
    const sketch = sketchFromKclValue(variables[variableName], variableName)
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
  updateArgs: ({ node, pathToNode, input, variables }) => {
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
    const varName = varDec.declaration.id.name
    const sketch = sketchFromKclValue(variables[varName], varName)
    if (err(sketch)) return sketch
    const intersectPath = sketch.paths.find(
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
          topLevelRange(angle.start, angle.end),
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
          topLevelRange(offset.start, offset.end),
          pathToOffsetProp
        )
      )
    }
    if (intersectTag !== -1) {
      const tag = firstArg.properties[intersectTag]?.value as Node<Identifier>
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
        topLevelRange(tag.start, tag.end),
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
        shebang: null,
        moduleId: 0,
        body: [],

        nonCodeMeta: {
          start: 0,
          end: 0,
          moduleId: 0,
          startNodes: [],
          nonCodeNodes: [],
        },
        innerAttrs: [],
        outerAttrs: [],
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
  angledLine,
  angledLineOfXLength,
  angledLineOfYLength,
  angledLineToX,
  angledLineToY,
  angledLineThatIntersects,
  tangentialArcTo,
  arc,
  arcTo,
} as const

export const sketchLineHelperMapKw: { [key: string]: SketchLineHelperKw } = {
  line,
  lineTo,
  circleThreePoint,
  circle,
  xLine,
  yLine,
  xLineTo,
  yLineTo,
} as const

export function changeSketchArguments(
  node: Node<Program>,
  variables: VariableMap,
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
): { modifiedAst: Node<Program>; pathToNode: PathToNode } | Error {
  // TODO/less-than-ideal, this obvious relies on node getting mutated, as changing the following with `_node = structuredClone(node)` breaks the draft line animation.
  const _node = { ...node }
  const thePath =
    sourceRangeOrPath.type === 'sourceRange'
      ? getNodePathFromSourceRange(_node, sourceRangeOrPath.sourceRange)
      : sourceRangeOrPath.pathToNode
  const nodeMeta = getNodeFromPath<CallExpression | CallExpressionKw>(
    _node,
    thePath
  )
  if (err(nodeMeta)) return nodeMeta

  const { node: callExpression, shallowPath } = nodeMeta

  const fnName = callExpression?.callee?.name
  if (fnName in sketchLineHelperMap) {
    const { updateArgs } = sketchLineHelperMap[callExpression.callee.name]
    if (!updateArgs) {
      return new Error('not a sketch line helper')
    }

    return updateArgs({
      node: _node,
      variables,
      pathToNode: shallowPath,
      input,
    })
  }
  if (fnName in sketchLineHelperMapKw) {
    const isAbsolute =
      callExpression.type === 'CallExpressionKw' &&
      findKwArg(ARG_END_ABSOLUTE, callExpression) !== undefined
    const correctFnName = fnNameToTooltip(isAbsolute, fnName)
    if (err(correctFnName)) {
      return correctFnName
    }
    const { updateArgs } = sketchLineHelperMapKw[correctFnName]
    if (!updateArgs) {
      return new Error('not a sketch line keyword helper')
    }

    return updateArgs({
      node: _node,
      variables,
      pathToNode: shallowPath,
      input,
    })
  }

  return new Error(`not a sketch line helper: ${fnName}`)
}

/**
 * Function names no longer cleanly correspond to tooltips.
 * A tooltip is a user action, like a line to a given point, or in a given direction.
 * These are two separate tooltips (line and lineTo) but are made by the same stdlib function,
 * 'line'. It just uses different parameters.
 *
 * To put it another way, function names don't map cleanly to tooltips, but function names + arguments do.
 */
export function fnNameToTooltip(
  isAbsolute: boolean,
  fnName: string
): ToolTip | Error {
  switch (fnName) {
    case 'line':
      return isAbsolute ? 'lineTo' : 'line'
    case 'xLine':
      return isAbsolute ? 'xLineTo' : 'xLine'
    case 'yLine':
      return isAbsolute ? 'yLineTo' : 'yLine'
    case 'circleThreePoint':
    case 'circle':
      return fnName
    default:
      const err = `Unknown sketch line function ${fnName}`
      console.error(err)
      return new Error(err)
  }
}

/**
 * Function names no longer cleanly correspond to tooltips.
 * A tooltip is a user action, like a line to a given point, or in a given direction.
 * These are two separate tooltips (line and lineTo) but are made by the same stdlib function,
 * 'line'. It just uses different parameters.
 *
 * To put it another way, function names don't map cleanly to tooltips, but function names + arguments do.
 */
export function tooltipToFnName(tooltip: ToolTip): string | Error {
  switch (tooltip) {
    case 'xLine':
    case 'yLine':
    case 'line':
      return tooltip
    case 'lineTo':
      return 'line'
    case 'xLineTo':
      return 'xLine'
    case 'yLineTo':
      return 'yLine'
    default:
      return new Error(`Unknown tooltip function ${tooltip}`)
  }
}

export function getConstraintInfo(
  callExpression: Node<CallExpression>,
  code: string,
  pathToNode: PathToNode,
  filterValue?: string
): ConstrainInfo[] {
  const fnName = callExpression?.callee?.name || ''
  if (!(fnName in sketchLineHelperMap)) return []
  return sketchLineHelperMap[fnName].getConstraintInfo(
    callExpression,
    code,
    pathToNode,
    filterValue
  )
}

export function getConstraintInfoKw(
  callExpression: Node<CallExpressionKw>,
  code: string,
  pathToNode: PathToNode,
  filterValue?: string
): ConstrainInfo[] {
  const fnName = callExpression?.callee?.name || ''
  const isAbsolute = isAbsoluteLine(callExpression)
  if (err(isAbsolute)) {
    console.error(
      `Could not tell if this call to ${fnName} was absolute`,
      isAbsolute
    )
    return []
  }
  if (!(fnName in sketchLineHelperMapKw)) return []
  const correctFnName = fnNameToTooltip(isAbsolute, fnName)
  if (err(correctFnName)) {
    console.error(correctFnName)
    return []
  }
  return sketchLineHelperMapKw[correctFnName].getConstraintInfo(
    callExpression,
    code,
    pathToNode,
    filterValue
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
  node: Node<Program>
  variables: VariableMap
  input: SegmentInputs
  fnName: ToolTip
  pathToNode: PathToNode
  spliceBetween?: boolean
}

export function addNewSketchLn({
  node: _node,
  variables,
  fnName,
  pathToNode,
  input: segmentInput,
  spliceBetween = false,
}: CreateLineFnCallArgs):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  const node = structuredClone(_node)
  const { add, updateArgs } =
    sketchLineHelperMap?.[fnName] || sketchLineHelperMapKw?.[fnName] || {}
  if (!add || !updateArgs) {
    return new Error(`${fnName} is not a sketch line helper`)
  }

  getNodeFromPath<Node<VariableDeclarator>>(
    node,
    pathToNode,
    'VariableDeclarator'
  )
  getNodeFromPath<Node<PipeExpression | CallExpression | CallExpressionKw>>(
    node,
    pathToNode,
    'PipeExpression'
  )
  return add({
    node,
    variables,
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
  node: Node<Program>
  variables: VariableMap
  pathToNode: PathToNode
  expressions: Node<CallExpression | CallExpressionKw>[]
}) {
  const _node = { ...node }
  const pipeExpression = getNodeFromPath<Node<PipeExpression>>(
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
  variables: VariableMap
  pathToNode: PathToNode
}) {
  const _node = { ...node }
  const closeExpression = createCallExpressionStdLibKw('close', null, [])
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
  variables,
  pathToNode: _pathToNode,
  fnName,
  segmentInput,
  replaceExistingCallback,
  referencedSegment,
}: {
  node: Node<Program>
  variables: VariableMap
  pathToNode: PathToNode
  fnName: ToolTip
  segmentInput: SegmentInputs
  replaceExistingCallback: (rawArgs: RawArgs) => CreatedSketchExprResult | Error
  referencedSegment?: Path
}):
  | {
      modifiedAst: Node<Program>
      valueUsedInTransform?: number
      pathToNode: PathToNode
    }
  | Error {
  if (![...toolTips, 'intersect', 'circle'].includes(fnName)) {
    return new Error(`The following function name  is not tooltip: ${fnName}`)
  }
  const _node = { ...node }

  const { add } =
    sketchLineHelperMap[fnName] === undefined
      ? sketchLineHelperMapKw[fnName]
      : sketchLineHelperMap[fnName]
  const addRetVal = add({
    node: _node,
    variables,
    pathToNode: _pathToNode,
    referencedSegment,
    segmentInput,
    replaceExistingCallback,
  })
  if (err(addRetVal)) return addRetVal

  const { modifiedAst, valueUsedInTransform, pathToNode } = addRetVal
  return { modifiedAst, valueUsedInTransform, pathToNode }
}

/** Ostensibly  should be used to add a chamfer tag to a chamfer call expression
 *
 * However things get complicated in situations like:
 * ```ts
 * |> chamfer(
 *     length = 1,
 *     tags = [tag1, tagOfInterest],
 *   )
 * ```
 * Because tag declarator is not allowed on a chamfer with more than one tag,
 * They must be pulled apart into separate chamfer calls:
 * ```ts
 * |> chamfer(
 *     length = 1,
 *     tags = [tag1],
 *   )
 * |> chamfer(
 *     length = 1,
 *     tags = [tagOfInterest],
 *   , tag = $newTagDeclarator)
 * ```
 */
function addTagToChamfer(
  tagInfo: AddTagInfo,
  edgeCutMeta: EdgeCutInfo
):
  | {
      modifiedAst: Node<Program>
      tag: string
    }
  | Error {
  const _node = structuredClone(tagInfo.node)
  let pipeIndex = 0
  for (let i = 0; i < tagInfo.pathToNode.length; i++) {
    if (tagInfo.pathToNode[i][1] === 'PipeExpression') {
      pipeIndex = Number(tagInfo.pathToNode[i + 1][0])
      break
    }
  }
  const pipeExpr = getNodeFromPath<PipeExpression>(
    _node,
    tagInfo.pathToNode,
    'PipeExpression'
  )
  const variableDec = getNodeFromPath<VariableDeclarator>(
    _node,
    tagInfo.pathToNode,
    'VariableDeclarator'
  )
  if (err(pipeExpr)) return pipeExpr
  if (err(variableDec)) return variableDec
  const isPipeExpression = pipeExpr.node.type === 'PipeExpression'

  const callExpr = isPipeExpression
    ? pipeExpr.node.body[pipeIndex]
    : variableDec.node.init
  if (callExpr.type !== 'CallExpressionKw')
    return new Error('no chamfer call Expr')
  const inputTags = findKwArg('tags', callExpr)
  if (!inputTags) return new Error('no tags property')
  if (inputTags.type !== 'ArrayExpression')
    return new Error('tags should be an array expression')

  const isChamferBreakUpNeeded = inputTags.elements.length > 1
  if (!isChamferBreakUpNeeded) {
    return addTagKw()(tagInfo)
  }

  // There's more than one input tag, we need to break that chamfer call into a separate chamfer call
  // so that it can have a tag declarator added.
  const tagIndexToPullOut = inputTags.elements.findIndex((tag) => {
    // e.g. chamfer(tags: [tagOfInterest, tag2])
    //                       ^^^^^^^^^^^^^
    const elementMatchesBaseTagType =
      edgeCutMeta?.subType === 'base' &&
      tag.type === 'Identifier' &&
      tag.name === edgeCutMeta.tagName
    if (elementMatchesBaseTagType) return true

    // e.g. chamfer(tags: [getOppositeEdge(tagOfInterest), tag2])
    //                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    const tagMatchesOppositeTagType =
      edgeCutMeta?.subType === 'opposite' &&
      tag.type === 'CallExpression' &&
      tag.callee.name === 'getOppositeEdge' &&
      tag.arguments[0].type === 'Identifier' &&
      tag.arguments[0].name === edgeCutMeta.tagName
    if (tagMatchesOppositeTagType) return true

    // e.g. chamfer(tags: [getNextAdjacentEdge(tagOfInterest), tag2])
    //                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    const tagMatchesAdjacentTagType =
      edgeCutMeta?.subType === 'adjacent' &&
      tag.type === 'CallExpression' &&
      (tag.callee.name === 'getNextAdjacentEdge' ||
        tag.callee.name === 'getPrevAdjacentEdge') &&
      tag.arguments[0].type === 'Identifier' &&
      tag.arguments[0].name === edgeCutMeta.tagName
    if (tagMatchesAdjacentTagType) return true
    return false
  })
  if (tagIndexToPullOut === -1) return new Error('tag not found')
  // get the tag we're pulling out
  const tagToPullOut = inputTags.elements[tagIndexToPullOut]
  // and remove it from the original chamfer call
  // [pullOutTag, tag2] to [tag2]
  inputTags.elements.splice(tagIndexToPullOut, 1)

  // get the length of the chamfer we're breaking up, as the new chamfer will have the same length
  const chamferLength = findKwArg('length', callExpr)
  if (!chamferLength) return new Error('no chamfer length')
  const tagDec = createTagDeclarator(findUniqueName(_node, 'seg', 2))
  const solid3dIdentifierUsedInOriginalChamfer = callExpr.unlabeled
  const solid = isPipeExpression ? null : solid3dIdentifierUsedInOriginalChamfer
  const newExpressionToInsert = createCallExpressionStdLibKw('chamfer', solid, [
    createLabeledArg('length', chamferLength),
    // single tag to add to the new chamfer call
    createLabeledArg('tags', createArrayExpression([tagToPullOut])),
    createLabeledArg('tag', tagDec),
  ])

  // insert the new chamfer call with the tag declarator, add it above the original
  // alternatively we could use `pipeIndex + 1` to insert it below the original
  if (isPipeExpression) {
    pipeExpr.node.body.splice(pipeIndex, 0, newExpressionToInsert)
  } else {
    callExpr.unlabeled = null // defaults to pipe substitution
    variableDec.node.init = createPipeExpression([
      newExpressionToInsert,
      callExpr,
    ])
  }
  return {
    modifiedAst: _node,
    tag: tagDec.value,
  }
}

export function addTagForSketchOnFace(
  tagInfo: AddTagInfo,
  expressionName: string,
  edgeCutMeta: EdgeCutInfo | null
):
  | {
      modifiedAst: Node<Program>
      tag: string
    }
  | Error {
  if (expressionName === 'close') {
    return addTagKw()(tagInfo)
  }
  if (expressionName === 'chamfer') {
    if (edgeCutMeta === null) {
      return new Error(
        'Cannot add tag to chamfer because no edge cut was provided'
      )
    }
    return addTagToChamfer(tagInfo, edgeCutMeta)
  }
  if (expressionName in sketchLineHelperMapKw) {
    const { addTag } = sketchLineHelperMapKw[expressionName]
    return addTag(tagInfo)
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

type addTagFn = (
  a: AddTagInfo
) => { modifiedAst: Node<Program>; tag: string } | Error

function addTag(tagIndex = 2): addTagFn {
  return ({ node, pathToNode }) => {
    const _node = { ...node }
    const callExpr = getNodeFromPath<Node<CallExpression>>(
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

function addTagKw(): addTagFn {
  return ({ node, pathToNode }) => {
    const _node = { ...node }
    // We have to allow for the possibility that the path is actually to a call expression.
    // That's because if the parser reads something like `close()`, it doesn't know if this
    // is a keyword or positional call.
    // In fact, even something like `close(%)` could be either (because we allow 1 unlabeled
    // starting param).
    const callExpr = getNodeFromPath<Node<CallExpressionKw | CallExpression>>(
      _node,
      pathToNode,
      ['CallExpressionKw', 'CallExpression']
    )
    if (err(callExpr)) return callExpr

    // If the original node is a call expression, we'll need to change it to a call with keyword args.
    const primaryCallExp: CallExpressionKw =
      callExpr.node.type === 'CallExpressionKw'
        ? callExpr.node
        : {
            type: 'CallExpressionKw',
            callee: callExpr.node.callee,
            unlabeled: callExpr.node.arguments.length
              ? callExpr.node.arguments[0]
              : null,
            nonCodeMeta: nonCodeMetaEmpty(),
            arguments: [],
          }
    const tagArg = findKwArg(ARG_TAG, primaryCallExp)
    const tagDeclarator =
      tagArg || createTagDeclarator(findUniqueName(_node, 'seg', 2))
    const isTagExisting = !!tagArg
    if (!isTagExisting) {
      const labeledArg = createLabeledArg(ARG_TAG, tagDeclarator)
      primaryCallExp.arguments.push(labeledArg)
    }

    // If we changed the node, we must replace the old node with the new node in the AST.
    const mustReplaceNode = primaryCallExp.type !== callExpr.node.type
    if (mustReplaceNode) {
      getNodeFromPath(_node, pathToNode, ['CallExpression'], false, {
        ...primaryCallExp,
        start: callExpr.node.start,
        end: callExpr.node.end,
        moduleId: callExpr.node.moduleId,
        outerAttrs: callExpr.node.outerAttrs,
      })
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
  return getValuesForXYFns(firstArg)
}

function getValuesForXYFns(arg: Expr):
  | {
      val: [Expr, Expr]
      tag?: Expr
    }
  | Error {
  if (arg.type === 'ArrayExpression') {
    return { val: [arg.elements[0], arg.elements[1]] }
  }
  if (arg.type === 'ObjectExpression') {
    const to = arg.properties.find((p) => p.key.name === 'to')?.value
    const tag = arg.properties.find((p) => p.key.name === 'tag')?.value
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
  console.warn('expected ArrayExpression or ObjectExpression')
  return {
    val: createLiteral(1),
  }
}

export const getCircle = (
  callExp: CallExpressionKw
):
  | {
      val: [Expr, Expr, Expr]
      tag?: Expr
    }
  | Error => {
  const firstArg = callExp.arguments[0]
  if (firstArg.type === 'LabeledArg') {
    let centerInfo = findKwArgWithIndex(ARG_CIRCLE_CENTER, callExp)
    let radiusInfo = findKwArgWithIndex(ARG_CIRCLE_RADIUS, callExp)
    let tagInfo = findKwArgWithIndex(ARG_TAG, callExp)
    if (centerInfo && radiusInfo) {
      if (centerInfo.expr?.type === 'ArrayExpression' && radiusInfo.expr) {
        return {
          val: [
            centerInfo.expr?.elements[0],
            centerInfo.expr?.elements[1],
            radiusInfo.expr,
          ],
          tag: tagInfo?.expr,
        }
      }
    }
  }
  return new Error('expected the arguments to be for a circle')
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

/**
Given a line call, return whether it's using absolute or relative end.
*/
export function isAbsoluteLine(lineCall: CallExpressionKw): boolean | Error {
  const name = lineCall?.callee?.name
  switch (name) {
    case 'line':
      if (findKwArg(ARG_END, lineCall) !== undefined) {
        return false
      }
      if (findKwArg(ARG_END_ABSOLUTE, lineCall) !== undefined) {
        return true
      }
      return new Error(
        `line call has neither ${ARG_END} nor ${ARG_END_ABSOLUTE} params`
      )
    case 'xLine':
    case 'yLine':
      if (findKwArg(ARG_LENGTH, lineCall) !== undefined) {
        return false
      }
      if (findKwArg(ARG_END_ABSOLUTE, lineCall) !== undefined) {
        return true
      }
      return new Error(
        `${name} call has neither ${ARG_END} nor ${ARG_END_ABSOLUTE} params`
      )
    case 'circleThreePoint':
      return false
  }
  return new Error(`Unknown sketch function ${name}`)
}

/**
Get the argument corresponding to 'end' or 'endAbsolute' or wherever the line actually ends.
Also known as the 'determining' arg.
*/
export function getArgForEnd(lineCall: CallExpressionKw):
  | {
      val: Expr | [Expr, Expr] | [Expr, Expr, Expr]
      tag?: Expr
    }
  | Error {
  const name = lineCall?.callee?.name

  switch (name) {
    case 'circle':
      return getCircle(lineCall)
    case 'line': {
      const arg = findKwArgAny(DETERMINING_ARGS, lineCall)
      if (arg === undefined) {
        return new Error("no end of the line was found in fn '" + name + "'")
      }
      return getValuesForXYFns(arg)
    }
    case 'yLine':
    case 'xLine':
      const arg = findKwArgAny(DETERMINING_ARGS, lineCall)
      const tag = findKwArg(ARG_TAG, lineCall)
      if (arg === undefined) {
        return new Error("no end of the line was found in fn '" + name + "'")
      } else {
        return { val: arg, tag }
      }
    default:
      return new Error(`unknown function ${name}`)
  }
}

export function getFirstArg(callExp: CallExpression):
  | {
      val: Expr | [Expr, Expr] | [Expr, Expr, Expr]
      tag?: Expr
    }
  | Error {
  const name = callExp?.callee?.name
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
  if (['angledLineThatIntersects'].includes(name)) {
    return getAngledLineThatIntersects(callExp)
  }
  if (['tangentialArcTo'].includes(name)) {
    // TODO probably needs it's own implementation
    return getFirstArgValuesForXYFns(callExp)
  }
  return new Error('unexpected call expression: ' + name)
}

/** A determining arg is one that determines the line, e.g. for xLine it's either 'length' or 'endAbsolute'
 */
function removeDeterminingArgs(callExp: CallExpressionKw) {
  removeKwArgs(DETERMINING_ARGS, callExp)
}
