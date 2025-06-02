import { perpendicularDistance } from 'sketch-helpers'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  ARG_ANGLE,
  ARG_ANGLE_END,
  ARG_AT,
  ARG_ANGLE_START,
  ARG_CIRCLE_CENTER,
  ARG_RADIUS,
  ARG_END,
  ARG_END_ABSOLUTE,
  ARG_END_ABSOLUTE_X,
  ARG_END_ABSOLUTE_Y,
  ARG_INTERSECT_TAG,
  ARG_LENGTH,
  ARG_LENGTH_X,
  ARG_LENGTH_Y,
  ARG_OFFSET,
  ARG_TAG,
  DETERMINING_ARGS,
  ARG_INTERIOR_ABSOLUTE,
} from '@src/lang/constants'
import {
  createArrayExpression,
  createBinaryExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createPipeExpression,
  createTagDeclarator,
  findUniqueName,
} from '@src/lang/create'
import type { ToolTip } from '@src/lang/langHelpers'
import { toolTips } from '@src/lang/langHelpers'
import {
  mutateKwArg,
  removeKwArgs,
  splitPathAtPipeExpression,
} from '@src/lang/modifyAst'
import { getNodeFromPath, getNodeFromPathCurry } from '@src/lang/queryAst'
import { ARG_INDEX_FIELD, LABELED_ARG_FIELD } from '@src/lang/queryAstConstants'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  isLiteralArrayOrStatic,
  isNotLiteralArrayOrStatic,
} from '@src/lang/std/sketchcombos'
import type {
  AddTagInfo,
  ArrayItemInput,
  ConstrainInfo,
  CreatedSketchExprResult,
  InputArgKeys,
  ObjectPropertyInput,
  RawArgs,
  SegmentInputs,
  SimplifiedArgDetails,
  SingleValueInput,
  SketchLineHelperKw,
  addCall,
} from '@src/lang/std/stdTypes'
import {
  findKwArg,
  findKwArgAny,
  findKwArgAnyIndex,
  findKwArgWithIndex,
  topLevelRange,
} from '@src/lang/util'
import type {
  CallExpressionKw,
  Expr,
  Path,
  PathToNode,
  PipeExpression,
  Program,
  Sketch,
  SourceRange,
  VariableDeclaration,
  VariableDeclarator,
  VariableMap,
} from '@src/lang/wasm'
import { sketchFromKclValue } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { allLabels, getAngle, getLength, roundOff } from '@src/lib/utils'
import type { EdgeCutInfo } from '@src/machines/modelingMachine'

const STRAIGHT_SEGMENT_ERR = () =>
  new Error('Invalid input, expected "straight-segment"')
const ARC_SEGMENT_ERR = () => new Error('Invalid input, expected "arc-segment"')
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
): ConstrainInfo => {
  const argPosition: SimplifiedArgDetails | undefined =
    g === 'singleValue'
      ? { type: 'singleValue' }
      : typeof g === 'number'
        ? { type: 'arrayItem', index: g }
        : typeof g === 'string'
          ? { type: 'objectProperty', key: g }
          : g?.type === 'labeledArg'
            ? g
            : g?.type === 'labeledArgArrayItem'
              ? g
              : undefined

  return {
    type: a,
    isConstrained: b,
    value: c,
    sourceRange: d,
    argPosition,
    pathToNode: e,
    stdLibFnName: f,
  }
}

const commonConstraintInfoHelper = (
  callExp: CallExpressionKw,
  inputConstrainTypes: [ConstrainInfo['type'], ConstrainInfo['type']],
  stdLibFnName: ConstrainInfo['stdLibFnName'],
  abbreviatedInputs: [
    {
      arrayInput?: 0 | 1
      objInput?: ObjectPropertyInput<any>['key']
      argLabel?: InputArgKeys
    },
    {
      arrayInput?: 0 | 1
      objInput?: ObjectPropertyInput<any>['key']
      argLabel?: InputArgKeys
    },
  ],
  code: string,
  pathToNode: PathToNode,
  filterValue?: string
) => {
  if (callExp.type !== 'CallExpressionKw') return []
  const firstArg: [Expr | undefined, { [key: string]: Expr } | undefined] =
    (() => {
      switch (callExp.type) {
        case 'CallExpressionKw':
          if (callExp.callee.name.name === 'angledLine') {
            const angleVal = findKwArg(ARG_ANGLE, callExp)
            if (angleVal === undefined) {
              return [undefined, undefined]
            }
            const lengthishIndex = findKwArgAnyIndex(
              [
                ARG_END_ABSOLUTE_X,
                ARG_END_ABSOLUTE_Y,
                ARG_LENGTH_X,
                ARG_LENGTH_Y,
                ARG_LENGTH,
              ],
              callExp
            )
            if (lengthishIndex === undefined) {
              return [undefined, undefined]
            }
            const lengthKey = callExp.arguments[lengthishIndex].label?.name
            if (lengthKey === undefined) {
              return [undefined, undefined]
            }
            const lengthVal = callExp.arguments[lengthishIndex].arg
            // Note: The order of keys here matters.
            // Always assumes the angle was the first param, and then the length followed.
            return [
              undefined,
              {
                angle: angleVal,
                [lengthKey]: lengthVal,
              },
            ]
          }
          return [findKwArgAny(DETERMINING_ARGS, callExp), undefined]
      }
    })()
  if (firstArg === undefined) {
    console.error(
      `Could not parse constraints because call to ${callExp.callee.name.name} was missing important arguments`
    )
    return []
  }
  const pipeExpressionIndex = pathToNode.findIndex(
    ([_, nodeName]) => nodeName === 'PipeExpression'
  )
  const pathToBase = pathToNode.slice(0, pipeExpressionIndex + 2)

  // Case where firstArg was a KCL expression.
  const firstArgInner = firstArg[0]
  if (firstArgInner !== undefined) {
    const isArr = firstArgInner?.type === 'ArrayExpression'
    const argIndex = (() => {
      switch (callExp.type) {
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
    if (!isArr && firstArgInner.type !== 'ObjectExpression') return []
    const pathToFirstArg: PathToNode = isArr
      ? [...pathToArrayExpression, [0, 'index']]
      : [
          ...pathToArrayExpression,
          [
            firstArgInner.properties.findIndex(
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
            firstArgInner.properties.findIndex(
              (a) => a.key.name === abbreviatedInputs[1].objInput
            ),
            'index',
          ],
          ['value', 'Property'],
        ]

    const input1 = isArr
      ? firstArgInner.elements[0]
      : firstArgInner.properties.find(
          (a) => a.key.name === abbreviatedInputs[0].objInput
        )?.value
    const input2 = isArr
      ? firstArgInner.elements[1]
      : firstArgInner.properties.find(
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
          isArr
            ? abbreviatedInputs[0].arrayInput
            : abbreviatedInputs[0].objInput,
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
          isArr
            ? abbreviatedInputs[1].arrayInput
            : abbreviatedInputs[1].objInput,
          topLevelRange(input2.start, input2.end),
          pathToSecondArg
        )
      )

    return constraints
  }

  // Case where the firstArg was an object of KCL expressions
  // (i.e. map of argument labels to argument values in a KW call)
  const multipleArgs = firstArg[1]
  if (multipleArgs === undefined) {
    console.error(
      `Could not parse constraints because call to ${callExp.callee.name.name} had the wrong argument structure`
    )
    return []
  }
  return Object.keys(multipleArgs).map((argLabel, i) => {
    const argValue: Expr = multipleArgs[argLabel]
    const pathToArg: PathToNode = [
      ...pathToBase,
      ['arguments', 'CallExpressionKw'],
      [i, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
    ]
    const label = abbreviatedInputs[i].argLabel
    return constrainInfo(
      inputConstrainTypes[i],
      isNotLiteralArrayOrStatic(argValue),
      code.slice(argValue.start, argValue.end),
      stdLibFnName,
      label === undefined ? undefined : { type: 'labeledArg', key: label },
      topLevelRange(argValue.start, argValue.end),
      pathToArg
    )
  })
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
  const mainArg = callExp.arguments?.[argIndex].arg
  const callee = callExp.callee
  const pathToFirstArg: PathToNode = [
    ...pathToNode,
    ['arguments', 'CallExpressionKw'],
    [argIndex, ARG_INDEX_FIELD],
    ['arg', LABELED_ARG_FIELD],
  ]
  const pathToCallee: PathToNode = [
    ...pathToNode,
    ['callee', 'CallExpressionKw'],
  ]
  return [
    constrainInfo(
      inputConstrainTypes[0],
      true,
      callee.name.name,
      stdLibFnName,
      undefined,
      topLevelRange(callee.start, callee.end),
      pathToCallee
    ),
    constrainInfo(
      inputConstrainTypes[1],
      isNotLiteralArrayOrStatic(mainArg),
      code.slice(mainArg.start, mainArg.end),
      stdLibFnName,
      abbreviatedInput,
      topLevelRange(mainArg.start, mainArg.end),
      pathToFirstArg
    ),
  ]
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
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
          type: 'labeledArgArrayItem',
          key: ARG_END_ABSOLUTE,
          index: 0,
          argType: 'xAbsolute',
          expr: newXVal,
        },
        {
          type: 'labeledArgArrayItem',
          key: ARG_END_ABSOLUTE,
          index: 1,
          argType: 'yAbsolute',
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
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
    const { to } = input
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

  getConstraintInfo: (callExp, code, pathToNode) => {
    const endAbsoluteArg = findKwArgWithIndex(ARG_END_ABSOLUTE, callExp)
    if (endAbsoluteArg === undefined) {
      return []
    }
    const { expr, argIndex } = endAbsoluteArg
    const constraints: ConstrainInfo[] = []
    if (!(expr.type === 'ArrayExpression' && expr.elements.length === 2)) {
      return []
    }
    const pipeExpressionIndex = pathToNode.findIndex(
      ([_, nodeName]) => nodeName === 'PipeExpression'
    )
    const pathToArg: PathToNode = [
      ...pathToNode.slice(0, pipeExpressionIndex + 2),
      ['arguments', 'CallExpressionKw'],
      [argIndex, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
      ['elements', 'ArrayExpression'],
    ]
    const pathToXArg: PathToNode = [...pathToArg, [0, 'index']]
    const pathToYArg: PathToNode = [...pathToArg, [1, 'index']]
    constraints.push(
      constrainInfo(
        'xAbsolute',
        isNotLiteralArrayOrStatic(expr.elements[0]),
        code.slice(expr.elements[0].start, expr.elements[0].end),
        'line',
        { type: 'labeledArgArrayItem', index: 0, key: ARG_END_ABSOLUTE },
        topLevelRange(expr.elements[0].start, expr.elements[0].end),
        pathToXArg
      )
    )
    constraints.push(
      constrainInfo(
        'yAbsolute',
        isNotLiteralArrayOrStatic(expr.elements[1]),
        code.slice(expr.elements[1].start, expr.elements[1].end),
        'line',
        { type: 'labeledArgArrayItem', index: 1, key: ARG_END_ABSOLUTE },
        topLevelRange(expr.elements[1].start, expr.elements[1].end),
        pathToYArg
      )
    )
    return constraints
  },
}

export const xLineTo: SketchLineHelperKw = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
          type: 'labeledArg',
          key: ARG_END_ABSOLUTE,
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
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
      { type: 'labeledArg', key: ARG_END_ABSOLUTE },
      ...args
    ),
}

export const yLineTo: SketchLineHelperKw = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
          type: 'labeledArg',
          key: ARG_END_ABSOLUTE,
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
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
      { type: 'labeledArg', key: ARG_END_ABSOLUTE },
      ...args
    ),
}

export const xLine: SketchLineHelperKw = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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

export const tangentialArc: SketchLineHelperKw = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    return tangentialArcHelpers.add({
      node,
      pathToNode,
      segmentInput,
      replaceExistingCallback,
      isAbsolute: false,
    })
  },
  updateArgs: ({ node, pathToNode, input }) => {
    return tangentialArcHelpers.update({
      node,
      pathToNode,
      input,
      isAbsolute: false,
    })
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp: CallExpressionKw, code, pathToNode) => {
    return tangentialArcHelpers.getConstraintInfo({
      callExp,
      code,
      pathToNode,
      isAbsolute: false,
    })
  },
}

export const tangentialArcTo: SketchLineHelperKw = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    return tangentialArcHelpers.add({
      node,
      pathToNode,
      segmentInput,
      replaceExistingCallback,
      isAbsolute: true,
    })
  },
  updateArgs: ({ node, pathToNode, input }) => {
    return tangentialArcHelpers.update({
      node,
      pathToNode,
      input,
      isAbsolute: true,
    })
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp: CallExpressionKw, code, pathToNode) => {
    return tangentialArcHelpers.getConstraintInfo({
      callExp,
      code,
      pathToNode,
      isAbsolute: true,
    })
  },
}

export const startProfile: SketchLineHelperKw = {
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
    const { to } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta

    const toArrExp = createArrayExpression([
      createLiteral(roundOff(to[0], 2)),
      createLiteral(roundOff(to[1], 2)),
    ])

    mutateKwArg(ARG_AT, callExpression, toArrExp)
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  add: ({ node, pathToNode, replaceExistingCallback, segmentInput }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
    const { to } = segmentInput
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

    const newXVal = createLiteral(roundOff(to[0], 2))
    const newYVal = createLiteral(roundOff(to[1], 2))

    if (!replaceExistingCallback && pipe.type === 'PipeExpression') {
      const callExp = createCallExpressionStdLibKw('line', null, [
        createLabeledArg(ARG_AT, createArrayExpression([newXVal, newYVal])),
      ])
      const pathToNodeIndex = pathToNode.findIndex(
        (x) => x[1] === 'PipeExpression'
      )
      const pipeIndex = pathToNode[pathToNodeIndex + 1][0]
      if (typeof pipeIndex === 'undefined' || typeof pipeIndex === 'string') {
        return new Error('pipeIndex is wrong')
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

    if (replaceExistingCallback && pipe.type === 'PipeExpression') {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const result = replaceExistingCallback([
        {
          type: 'labeledArgArrayItem',
          key: ARG_AT,
          index: 0,
          argType: 'xAbsolute',
          expr: newXVal,
        },
        {
          type: 'labeledArgArrayItem',
          key: ARG_AT,
          index: 1,
          argType: 'yAbsolute',
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

    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getConstraintInfo: (callExp, code, pathToNode) => {
    if (callExp.type !== 'CallExpressionKw') return []
    if (callExp.callee.name.name !== 'startProfile') return []
    const expr = findKwArgWithIndex(ARG_AT, callExp)?.expr
    if (expr?.type !== 'ArrayExpression') {
      return []
    }
    const argIndex = findKwArgAnyIndex([ARG_AT], callExp)
    if (argIndex === undefined) {
      return []
    }
    const pathToXYArray: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpressionKw'],
      [argIndex, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
      ['elements', 'ArrayExpression'],
    ]
    const xArg = expr.elements[0]
    const yArg = expr.elements[1]
    const constraints: ConstrainInfo[] = [
      {
        stdLibFnName: 'startProfile',
        type: 'xAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(xArg),
        sourceRange: topLevelRange(xArg.start, xArg.end),
        pathToNode: [...pathToXYArray, [0, 'index']],
        value: code.slice(xArg.start, xArg.end),
        argPosition: {
          type: 'labeledArgArrayItem',
          index: 0,
          key: ARG_AT,
        },
      },
      {
        stdLibFnName: 'startProfile',
        type: 'yAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(yArg),
        sourceRange: topLevelRange(yArg.start, yArg.end),
        pathToNode: [...pathToXYArray, [1, 'index']],
        value: code.slice(yArg.start, yArg.end),
        argPosition: {
          type: 'labeledArgArrayItem',
          index: 1,
          key: ARG_AT,
        },
      },
    ]
    return constraints
  },
}

export const circle: SketchLineHelperKw = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'arc-segment') return ARC_SEGMENT_ERR()

    const { center, radius } = segmentInput
    const _node = { ...node }

    // Try to get the pipe expression first
    const nodeMeta = getNodeFromPath<PipeExpression>(
      _node,
      pathToNode,
      'PipeExpression'
    )

    // If we get a pipe expression, handle as before
    if (!err(nodeMeta) && nodeMeta.node.type === 'PipeExpression') {
      const { node: pipe } = nodeMeta

      const x = createLiteral(roundOff(center[0], 2))
      const y = createLiteral(roundOff(center[1], 2))
      const radiusExp = createLiteral(roundOff(radius, 2))
      const centerArray = createArrayExpression([x, y])

      if (replaceExistingCallback) {
        const result = replaceExistingCallback([
          {
            type: 'labeledArgArrayItem',
            argType: 'xAbsolute',
            key: ARG_CIRCLE_CENTER,
            index: 0,
            expr: x,
          },
          {
            type: 'labeledArgArrayItem',
            argType: 'yAbsolute',
            key: ARG_CIRCLE_CENTER,
            index: 1,
            expr: y,
          },
          {
            type: 'labeledArg',
            argType: 'radius',
            key: ARG_RADIUS,
            expr: radiusExp,
          },
        ])
        if (err(result)) return result
        const { callExp, valueUsedInTransform } = result

        const { index: callIndex } = splitPathAtPipeExpression(pathToNode)

        // Handle the case where the returned expression is not a proper kwarg expression
        if (callExp.type !== 'CallExpressionKw') {
          // In a pipe expression, the unlabeled first arg can be omitted
          const centerArg = createLabeledArg(ARG_CIRCLE_CENTER, centerArray)
          const radiusArg = createLabeledArg(ARG_RADIUS, radiusExp)
          const circleKw = createCallExpressionStdLibKw('circle', null, [
            centerArg,
            radiusArg,
          ])

          pipe.body[callIndex] = circleKw
        } else {
          // For CallExpressionKw, we don't need to set an unlabeled argument in pipe expressions
          if (callExp.unlabeled) {
            callExp.unlabeled = null
          }
          pipe.body[callIndex] = callExp
        }

        return {
          modifiedAst: _node,
          pathToNode,
          valueUsedInTransform,
        }
      }
      return new Error('Problem with circle')
    }

    // If it's not in a pipe expression, try to get variable declarator
    const varDecMeta = getNodeFromPath<VariableDeclarator>(
      _node,
      pathToNode,
      'VariableDeclarator'
    )

    if (err(varDecMeta))
      return new Error('Could not find pipe expression or variable declarator')

    const { node: varDec } = varDecMeta

    // Get the existing circle expression to extract the unlabeled first argument (sketch)
    const existingCircleExpr = varDec.init as Node<CallExpressionKw>
    let sketchArg: Expr | null = null

    // Extract the unlabeled sketch argument if it exists
    if (existingCircleExpr && existingCircleExpr.type === 'CallExpressionKw') {
      sketchArg = existingCircleExpr.unlabeled
    }

    // These follow the same pattern whether we use the callback or not
    const x = createLiteral(roundOff(center[0], 2))
    const y = createLiteral(roundOff(center[1], 2))
    const radiusExp = createLiteral(roundOff(radius, 2))
    const centerArray = createArrayExpression([x, y])

    if (replaceExistingCallback) {
      // debugger
      const result = replaceExistingCallback([
        {
          type: 'labeledArgArrayItem',
          argType: 'xAbsolute',
          key: ARG_CIRCLE_CENTER,
          index: 0,
          expr: x,
        },
        {
          type: 'labeledArgArrayItem',
          argType: 'yAbsolute',
          key: ARG_CIRCLE_CENTER,
          index: 1,
          expr: y,
        },
        {
          type: 'labeledArg',
          argType: 'radius',
          key: ARG_RADIUS,
          expr: radiusExp,
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result

      // Make sure the unlabeled first argument (sketch) is preserved
      if (callExp.type === 'CallExpressionKw') {
        if (sketchArg && !callExp.unlabeled) {
          callExp.unlabeled = sketchArg
        }

        // Replace the variable declarator init with the call expression
        varDec.init = callExp
      } else {
        // If somehow we get a non-kw expression, create the correct one
        const centerArg = createLabeledArg(ARG_CIRCLE_CENTER, centerArray)
        const radiusArg = createLabeledArg(ARG_RADIUS, radiusExp)
        const circleKw = createCallExpressionStdLibKw('circle', sketchArg, [
          centerArg,
          radiusArg,
        ])

        // Replace the variable declarator init with the correct KW expression
        varDec.init = circleKw
      }

      return {
        modifiedAst: _node,
        pathToNode,
        valueUsedInTransform,
      }
    } else {
      // If no callback, create a CallExpressionKw directly
      const centerArg = createLabeledArg(ARG_CIRCLE_CENTER, centerArray)
      const radiusArg = createLabeledArg(ARG_RADIUS, radiusExp)
      const circleKw = createCallExpressionStdLibKw('circle', sketchArg, [
        centerArg,
        radiusArg,
      ])

      // Replace the variable declarator init with the call expression
      varDec.init = circleKw

      return {
        modifiedAst: _node,
        pathToNode,
      }
    }
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'arc-segment') return ARC_SEGMENT_ERR()
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
    mutateKwArg(ARG_RADIUS, callExpression, newRadius)
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
    let radiusInfo = findKwArgWithIndex(ARG_RADIUS, callExp)
    if (!centerInfo || !radiusInfo) return []
    if (centerInfo?.expr.type !== 'ArrayExpression') return []

    const pathToCenterArrayExpression: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpressionKw'],
      [centerInfo.argIndex, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
      ['elements', 'ArrayExpression'],
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

    const constraints: ConstrainInfo[] = [
      {
        stdLibFnName: 'circle',
        type: 'radius',
        isConstrained: isNotLiteralArrayOrStatic(radiusInfo.expr),
        sourceRange: topLevelRange(radiusInfo.expr.start, radiusInfo.expr.end),
        pathToNode: pathToRadiusLiteral,
        value: code.slice(radiusInfo.expr.start, radiusInfo.expr.end),
        argPosition: {
          type: 'labeledArg',
          key: ARG_RADIUS,
        },
      },
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
          type: 'labeledArgArrayItem',
          index: 0,
          key: ARG_CIRCLE_CENTER,
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
          type: 'labeledArgArrayItem',
          index: 1,
          key: 'center',
        },
      },
    ]
    return constraints
  },
}

export const arc: SketchLineHelperKw = {
  add: ({
    node,
    variables,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
    spliceBetween,
  }) => {
    if (segmentInput.type !== 'arc-segment') return ARC_SEGMENT_ERR()
    const { center, radius, from, to } = segmentInput
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

    // Calculate start angle (from center to 'from' point)
    const startAngle = Math.atan2(from[1] - center[1], from[0] - center[0])

    // Calculate end angle (from center to 'to' point)
    const endAngle = Math.atan2(to[1] - center[1], to[0] - center[0])

    // Create literals for the angles (convert to degrees)
    const startAngleDegrees = (startAngle * 180) / Math.PI
    const endAngleDegrees = (endAngle * 180) / Math.PI

    const newArc = createCallExpressionStdLibKw('arc', null, [
      createLabeledArg('radius', createLiteral(roundOff(radius))),
      createLabeledArg(
        'angleStart',
        createLiteral(roundOff(startAngleDegrees))
      ),
      createLabeledArg('angleEnd', createLiteral(roundOff(endAngleDegrees))),
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

    if (replaceExistingCallback && pipe.type !== 'CallExpressionKw') {
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
          [pipe.body.length - 1, 'CallExpressionKw'],
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
          [pipe.body.length - 1, 'CallExpressionKw'],
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
    if (input.type !== 'arc-segment') return ARC_SEGMENT_ERR()
    const { center, radius, from, to } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression, shallowPath } = nodeMeta

    // Calculate start angle (from center to 'from' point)
    const startAngle = Math.atan2(from[1] - center[1], from[0] - center[0])

    // Calculate end angle (from center to 'to' point)
    const endAngle = Math.atan2(to[1] - center[1], to[0] - center[0])

    // Create literals for the angles (convert to degrees)
    const startAngleDegrees = (startAngle * 180) / Math.PI
    const endAngleDegrees = (endAngle * 180) / Math.PI

    const newRadius = createLiteral(roundOff(radius))
    const newAngleStart = createLiteral(roundOff(startAngleDegrees))
    const newAngleEnd = createLiteral(roundOff(endAngleDegrees))
    mutateKwArg('radius', callExpression, newRadius)
    mutateKwArg('angleStart', callExpression, newAngleStart)
    mutateKwArg('angleEnd', callExpression, newAngleEnd)

    return {
      modifiedAst: _node,
      pathToNode: shallowPath,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp, code, pathToNode, filterValue) => {
    // TODO this isn't quiet right, the filter value needs to be added to group the radius and start angle together
    // with the end angle by itself,
    // also both angles are just called angle, which is not correct
    if (callExp.type !== 'CallExpressionKw') return []

    const returnVal = []
    const pathToBase: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpressionKw'],
    ]

    // Find radius, angleStart, and angleEnd properties
    const angleStart = findKwArgWithIndex(ARG_ANGLE_START, callExp)
    const angleEnd = findKwArgWithIndex(ARG_ANGLE_END, callExp)
    const radius = findKwArgWithIndex(ARG_RADIUS, callExp)
    if (!radius || !angleStart || !angleEnd) return []
    const pathToAngleStartArg: PathToNode = [
      ...pathToBase,
      [angleStart.argIndex, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
    ]
    returnVal.push(
      constrainInfo(
        'angle',
        isNotLiteralArrayOrStatic(angleStart.expr),
        code.slice(angleStart.expr.start, angleStart.expr.end),
        'arc',
        { type: 'labeledArg', key: ARG_ANGLE_START },
        topLevelRange(angleStart.expr.start, angleStart.expr.end),
        pathToAngleStartArg
      )
    )
    const pathToAngleEndArg: PathToNode = [
      ...pathToBase,
      [angleEnd.argIndex, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
    ]
    returnVal.push(
      constrainInfo(
        'angle',
        isNotLiteralArrayOrStatic(angleEnd.expr),
        code.slice(angleEnd.expr.start, angleEnd.expr.end),
        'arc',
        { type: 'labeledArg', key: ARG_ANGLE_END },
        topLevelRange(angleEnd.expr.start, angleEnd.expr.end),
        pathToAngleEndArg
      )
    )
    const pathToRadiusArg: PathToNode = [
      ...pathToBase,
      [radius.argIndex, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
    ]
    returnVal.push(
      constrainInfo(
        'angle',
        isNotLiteralArrayOrStatic(radius.expr),
        code.slice(radius.expr.start, radius.expr.end),
        'arc',
        { type: 'labeledArg', key: ARG_RADIUS },
        topLevelRange(radius.expr.start, radius.expr.end),
        pathToRadiusArg
      )
    )

    const constraints: ConstrainInfo[] = [
      constrainInfo(
        'radius',
        isNotLiteralArrayOrStatic(radius.expr),
        code.slice(radius.expr.start, radius.expr.end),
        'arc',
        'radius',
        topLevelRange(radius.expr.start, radius.expr.end),
        pathToRadiusArg
      ),
      constrainInfo(
        'angle',
        isNotLiteralArrayOrStatic(angleStart.expr),
        code.slice(angleStart.expr.start, angleStart.expr.end),
        'arc',
        'angleStart',
        topLevelRange(angleStart.expr.start, angleStart.expr.end),
        pathToAngleStartArg
      ),
      constrainInfo(
        'angle',
        isNotLiteralArrayOrStatic(angleEnd.expr),
        code.slice(angleEnd.expr.start, angleEnd.expr.end),
        'arc',
        'angleEnd',
        topLevelRange(angleEnd.expr.start, angleEnd.expr.end),
        pathToAngleEndArg
      ),
    ]

    return constraints
  },
}
export const arcTo: SketchLineHelperKw = {
  add: ({
    node,
    variables,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
    spliceBetween,
  }) => {
    if (segmentInput.type !== 'circle-three-point-segment')
      return ARC_SEGMENT_ERR()

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
    // p2 is the interiorAbsolute point
    // p3 is the end point
    const p2x = createLiteral(roundOff(p2[0], 2))
    const p2y = createLiteral(roundOff(p2[1], 2))
    const interiorAbsolute = createArrayExpression([p2x, p2y])

    const p3x = createLiteral(roundOff(p3[0], 2))
    const p3y = createLiteral(roundOff(p3[1], 2))
    const end = createArrayExpression([p3x, p3y])

    if (replaceExistingCallback) {
      const result = replaceExistingCallback([
        {
          type: 'labeledArgArrayItem',
          key: 'interiorAbsolute',
          index: 0,
          argType: 'xAbsolute',
          expr: p2x,
        },
        {
          type: 'labeledArgArrayItem',
          key: 'interiorAbsolute',
          index: 1,
          argType: 'yAbsolute',
          expr: p2y,
        },
        {
          type: 'labeledArgArrayItem',
          key: 'endAbsolute',
          index: 0,
          argType: 'xAbsolute',
          expr: p3x,
        },
        {
          type: 'labeledArgArrayItem',
          key: 'endAbsolute',
          index: 1,
          argType: 'yAbsolute',
          expr: p3y,
        },
      ])
      if (err(result)) return result
      const { callExp, valueUsedInTransform } = result

      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      pipe.body[callIndex] = callExp

      return {
        modifiedAst: _node,
        pathToNode: [
          ...pathToNode.slice(
            0,
            pathToNode.findIndex(([_, type]) => type === 'PipeExpression') + 1
          ),
          [pipe.body.length - 1, 'CallExpressionKw'],
        ],
        valueUsedInTransform,
      }
    }

    const newLine = createCallExpressionStdLibKw('arc', null, [
      createLabeledArg(ARG_INTERIOR_ABSOLUTE, interiorAbsolute),
      createLabeledArg(ARG_END_ABSOLUTE, end),
    ])

    if (spliceBetween) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      pipe.body.splice(callIndex + 1, 0, newLine)
    } else if (pipe.type === 'PipeExpression') {
      pipe.body.push(newLine)
    } else {
      const nodeMeta2 = getNodeFromPath<VariableDeclarator>(
        _node,
        pathToNode,
        'VariableDeclarator'
      )
      if (err(nodeMeta2)) return nodeMeta2
      const { node: varDec } = nodeMeta2
      varDec.init = createPipeExpression([varDec.init, newLine])
      return {
        modifiedAst: _node,
        pathToNode: [
          ...pathToNode.slice(
            0,
            pathToNode.findIndex(([key, _]) => key === 'init') + 1
          ),
          ['body', 'PipeExpression'],
          [1, 'CallExpressionKw'],
        ],
      }
    }

    return {
      modifiedAst: _node,
      pathToNode: [
        ...pathToNode.slice(
          0,
          pathToNode.findIndex(([_, type]) => type === 'PipeExpression') + 1
        ),
        [pipe.body.length - 1, 'CallExpressionKw'],
      ],
    }
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'circle-three-point-segment') return ARC_SEGMENT_ERR()

    const { p2, p3 } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression } = nodeMeta

    // Update the first argument which should be an object with interiorAbsolute and end properties

    const interiorAbsolutePoint = createArrayExpression([
      createLiteral(roundOff(p2[0], 2)),
      createLiteral(roundOff(p2[1], 2)),
    ])

    const endPoint = createArrayExpression([
      createLiteral(roundOff(p3[0], 2)),
      createLiteral(roundOff(p3[1], 2)),
    ])

    mutateKwArg(ARG_INTERIOR_ABSOLUTE, callExpression, interiorAbsolutePoint)
    mutateKwArg(ARG_END_ABSOLUTE, callExpression, endPoint)

    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp, code, pathToNode, filterValue) => {
    if (callExp.type !== 'CallExpressionKw') return []
    const args = callExp.arguments
    if (args.length < 1) return []

    // Find interiorAbsolute and end properties
    const interiorAbsoluteProp = findKwArgWithIndex(
      ARG_INTERIOR_ABSOLUTE,
      callExp
    )
    const endProp = findKwArgWithIndex(ARG_END_ABSOLUTE, callExp)

    if (!interiorAbsoluteProp || !endProp) return []
    if (
      interiorAbsoluteProp.expr.type !== 'ArrayExpression' ||
      endProp.expr.type !== 'ArrayExpression'
    )
      return []

    const interiorAbsoluteArr = interiorAbsoluteProp.expr
    const endArr = endProp.expr

    if (interiorAbsoluteArr.elements.length < 2 || endArr.elements.length < 2)
      return []

    const pathToBase: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpressionKw'],
    ]

    const pathToInteriorValue: PathToNode = [
      ...pathToBase,
      [interiorAbsoluteProp.argIndex, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
    ]

    const pathToEndValue: PathToNode = [
      ...pathToBase,
      [endProp.argIndex, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
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

    const constraints: (ConstrainInfo & { filterValue: string })[] = [
      {
        type: 'xAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(
          interiorAbsoluteArr.elements[0]
        ),
        value: code.slice(
          interiorAbsoluteArr.elements[0].start,
          interiorAbsoluteArr.elements[0].end
        ),
        stdLibFnName: 'arcTo',
        argPosition: {
          type: 'labeledArgArrayItem',
          key: ARG_INTERIOR_ABSOLUTE,
          index: 0,
        },
        sourceRange: topLevelRange(
          interiorAbsoluteArr.elements[0].start,
          interiorAbsoluteArr.elements[0].end
        ),
        pathToNode: pathToInteriorX,
        filterValue: ARG_INTERIOR_ABSOLUTE,
      },
      {
        type: 'yAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(
          interiorAbsoluteArr.elements[1]
        ),
        value: code.slice(
          interiorAbsoluteArr.elements[1].start,
          interiorAbsoluteArr.elements[1].end
        ),
        stdLibFnName: 'arcTo',
        argPosition: {
          type: 'labeledArgArrayItem',
          key: ARG_INTERIOR_ABSOLUTE,
          index: 1,
        },
        sourceRange: topLevelRange(
          interiorAbsoluteArr.elements[1].start,
          interiorAbsoluteArr.elements[1].end
        ),
        pathToNode: pathToInteriorY,
        filterValue: ARG_INTERIOR_ABSOLUTE,
      },
      {
        type: 'xAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(endArr.elements[0]),
        value: code.slice(endArr.elements[0].start, endArr.elements[0].end),
        stdLibFnName: 'arcTo',
        argPosition: {
          type: 'labeledArgArrayItem',
          key: 'endAbsolute',
          index: 0,
        },
        sourceRange: topLevelRange(
          endArr.elements[0].start,
          endArr.elements[0].end
        ),
        pathToNode: pathToEndX,
        filterValue: 'endAbsolute',
      },
      {
        type: 'yAbsolute',
        isConstrained: isNotLiteralArrayOrStatic(endArr.elements[1]),
        value: code.slice(endArr.elements[1].start, endArr.elements[1].end),
        stdLibFnName: 'arcTo',
        argPosition: {
          type: 'labeledArgArrayItem',
          key: 'endAbsolute',
          index: 1,
        },
        sourceRange: topLevelRange(
          endArr.elements[1].start,
          endArr.elements[1].end
        ),
        pathToNode: pathToEndY,
        filterValue: 'endAbsolute',
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
          type: 'labeledArgArrayItem',
          index: 0,
          key: 'p1',
          argType: 'xAbsolute',
          expr: createRoundedLiteral(p1[0]),
        },
        {
          type: 'labeledArgArrayItem',
          index: 1,
          key: 'p1',
          argType: 'yAbsolute',
          expr: createRoundedLiteral(p1[1]),
        },
        {
          type: 'labeledArgArrayItem',
          index: 0,
          key: 'p2',
          argType: 'xAbsolute',
          expr: createRoundedLiteral(p2[0]),
        },
        {
          type: 'labeledArgArrayItem',
          index: 1,
          key: 'p2',
          argType: 'yAbsolute',
          expr: createRoundedLiteral(p2[1]),
        },
        {
          type: 'labeledArgArrayItem',
          index: 0,
          key: 'p3',
          argType: 'xAbsolute',
          expr: createRoundedLiteral(p3[0]),
        },
        {
          type: 'labeledArgArrayItem',
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
      ['arg', LABELED_ARG_FIELD],
      ['elements', 'ArrayExpression'],
    ]
    const pathToP2ArrayExpression: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpressionKw'],
      [p2Details.argIndex, 'arg index'],
      ['arg', LABELED_ARG_FIELD],
      ['elements', 'ArrayExpression'],
    ]
    const pathToP3ArrayExpression: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpressionKw'],
      [p3Details.argIndex, 'arg index'],
      ['arg', LABELED_ARG_FIELD],
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
          type: 'labeledArgArrayItem',
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
          type: 'labeledArgArrayItem',
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
          type: 'labeledArgArrayItem',
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
          type: 'labeledArgArrayItem',
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
          type: 'labeledArgArrayItem',
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
          type: 'labeledArgArrayItem',
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

export const angledLine: SketchLineHelperKw = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback, snaps }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
    const { from, to } = segmentInput
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const _node1 = getNode<PipeExpression>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1

    // When snapping to previous arc's tangent direction, create this expression:
    //  angledLine(angle = tangentToEnd(arc001), length = 12)
    // Or if snapping to the negative direction:
    //  angledLine(angle = tangentToEnd(arc001) + turns::HALF_TURN, length = 12)
    const newAngleVal = snaps?.previousArcTag
      ? snaps.negativeTangentDirection
        ? createBinaryExpression([
            createCallExpressionStdLibKw(
              'tangentToEnd',
              createLocalName(snaps?.previousArcTag),
              []
            ),
            '+',
            createLocalName('turns::HALF_TURN'),
          ])
        : createCallExpressionStdLibKw(
            'tangentToEnd',
            createLocalName(snaps?.previousArcTag),
            []
          )
      : createLiteral(roundOff(getAngle(from, to), 0))
    const newLengthVal = createLiteral(roundOff(getLength(from, to), 2))
    const newLine = createCallExpressionStdLibKw('angledLine', null, [
      createLabeledArg(ARG_ANGLE, newAngleVal),
      createLabeledArg(ARG_LENGTH, newLengthVal),
    ])

    if (replaceExistingCallback) {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const result = replaceExistingCallback([
        {
          type: 'labeledArg',
          key: 'angle',
          argType: 'angle',
          // We cannot pass newAngleVal to expr because it is a Node<Literal>.
          // We couldn't change that type to be Node<Expr> because there is a lot of code assuming it to be Node<Literal>.
          // So we added a new optional overrideExpr which can be Node<Expr> and this is used if present in sketchcombos/createNode().
          expr:
            newAngleVal.type === 'Literal' ? newAngleVal : createLiteral(''),
          overrideExpr: newAngleVal,
        },
        {
          type: 'labeledArg',
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
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
    const angle = roundOff(getAngle(from, to), 0)
    const lineLength = roundOff(getLength(from, to), 2)

    const angleLit = createLiteral(angle)
    const lengthLit = createLiteral(lineLength)

    mutateKwArg(ARG_ANGLE, callExpression, angleLit)
    mutateKwArg(ARG_LENGTH, callExpression, lengthLit)

    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp, ...args) => {
    const constraints = commonConstraintInfoHelper(
      callExp,
      ['angle', 'length'],
      'angledLine',
      [{ argLabel: 'angle' }, { argLabel: 'length' }],
      ...args
    )

    return constraints
  },
}

export const angledLineOfXLength: SketchLineHelperKw = {
  add: ({
    node,
    variables,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
  }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
          type: 'labeledArg',
          key: 'angle',
          argType: 'angle',
          expr: angle,
        },
        {
          type: 'labeledArg',
          key: 'lengthX',
          argType: 'xRelative',
          expr: xLength,
        },
      ])
      if (err(result)) return result
      newLine = result.callExp
    } else {
      newLine = createCallExpressionStdLibKw('angledLineOfXLength', null, [
        createLabeledArg(ARG_ANGLE, angle),
        createLabeledArg(ARG_LENGTH_X, xLength),
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
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
    const angle = roundOff(getAngle(from, to), 0)
    const xLength = roundOff(Math.abs(to[0] - from[0]), 2)

    const oldAngle = findKwArg(ARG_ANGLE, callExpression)
    if (oldAngle === undefined) {
      return new Error(
        `expected an angle arg, but it was not found. Args were ${allLabels(
          callExpression
        )}`
      )
    }
    const adjustedXLength = isAngleLiteral(oldAngle)
      ? Math.abs(xLength)
      : xLength // todo make work for variable angle > 180

    const angleLit = createLiteral(angle)
    const lengthLit = createLiteral(adjustedXLength)

    removeDeterminingArgs(callExpression)
    mutateKwArg(ARG_ANGLE, callExpression, angleLit)
    mutateKwArg(ARG_LENGTH_X, callExpression, lengthLit)

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
      ['angle', 'xRelative'],
      'angledLine',
      [{ argLabel: 'angle' }, { argLabel: 'lengthX' }],
      ...args
    ),
}

export const angledLineOfYLength: SketchLineHelperKw = {
  add: ({
    node,
    variables,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
  }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
          type: 'labeledArg',
          key: 'angle',
          argType: 'angle',
          expr: angle,
        },
        {
          type: 'labeledArg',
          key: 'lengthY',
          argType: 'yRelative',
          expr: yLength,
        },
      ])
      if (err(result)) return result
      newLine = result.callExp
    } else {
      newLine = createCallExpressionStdLibKw('angledLine', null, [
        createLabeledArg(ARG_ANGLE, angle),
        createLabeledArg(ARG_LENGTH_Y, yLength),
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
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta
    const angle = roundOff(getAngle(from, to), 0)
    const yLength = roundOff(to[1] - from[1], 2)

    const oldAngle = findKwArg(ARG_ANGLE, callExpression)
    if (oldAngle === undefined) {
      return new Error(
        `expected an angle arg, but it was not found. Args were ${allLabels(
          callExpression
        )}`
      )
    }
    const adjustedYLength = isAngleLiteral(oldAngle)
      ? Math.abs(yLength)
      : yLength // todo make work for variable angle > 180

    const angleLit = createLiteral(angle)
    const lengthLit = createLiteral(adjustedYLength)

    removeDeterminingArgs(callExpression)
    mutateKwArg(ARG_ANGLE, callExpression, angleLit)
    mutateKwArg(ARG_LENGTH_Y, callExpression, lengthLit)

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
      ['angle', 'yRelative'],
      'angledLineOfYLength',
      [{ argLabel: 'angle' }, { argLabel: 'lengthY' }],
      ...args
    ),
}

export const angledLineToX: SketchLineHelperKw = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
          type: 'labeledArg',
          key: 'angle',
          argType: 'angle',
          expr: angle,
        },
        {
          type: 'labeledArg',
          key: 'endAbsoluteX',
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

    const callExp = createCallExpressionStdLibKw('angledLineToX', null, [
      createLabeledArg(ARG_ANGLE, angle),
      createLabeledArg(ARG_END_ABSOLUTE_X, xArg),
    ])
    pipe.body = [...pipe.body, callExp]
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression } = nodeMeta
    const angle = roundOff(getAngle(from, to), 0)
    const xLength = roundOff(to[0], 2)

    const adjustedXLength = xLength

    const angleLit = createLiteral(angle)
    const lengthLit = createLiteral(adjustedXLength)

    removeDeterminingArgs(callExpression)
    mutateKwArg(ARG_ANGLE, callExpression, angleLit)
    mutateKwArg(ARG_END_ABSOLUTE_X, callExpression, lengthLit)
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
      ['angle', 'xAbsolute'],
      'angledLineToX',
      [{ argLabel: 'angle' }, { argLabel: 'endAbsoluteX' }],
      ...args
    ),
}

export const angledLineToY: SketchLineHelperKw = {
  add: ({ node, pathToNode, segmentInput, replaceExistingCallback }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
          type: 'labeledArg',
          key: 'angle',
          argType: 'angle',
          expr: angle,
        },
        {
          type: 'labeledArg',
          key: 'endAbsoluteY',
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

    const newLine = createCallExpressionStdLibKw('angledLine', null, [
      createLabeledArg(ARG_ANGLE, angle),
      createLabeledArg(ARG_END_ABSOLUTE_Y, yArg),
    ])
    pipe.body = [...pipe.body, newLine]
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  updateArgs: ({ node, pathToNode, input }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression } = nodeMeta
    const angle = roundOff(getAngle(from, to), 0)
    const xLength = roundOff(to[1], 2)

    const adjustedXLength = xLength

    const angleLit = createLiteral(angle)
    const lengthLit = createLiteral(adjustedXLength)

    removeDeterminingArgs(callExpression)
    mutateKwArg(ARG_ANGLE, callExpression, angleLit)
    mutateKwArg(ARG_END_ABSOLUTE_Y, callExpression, lengthLit)
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
      ['angle', 'yAbsolute'],
      'angledLineToY',
      [{ argLabel: 'angle' }, { argLabel: 'endAbsoluteY' }],
      ...args
    ),
}

export const angledLineThatIntersects: SketchLineHelperKw = {
  add: ({
    node,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
    referencedSegment,
  }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
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
          type: 'labeledArg',
          key: 'angle',
          argType: 'angle',
          expr: angle,
        },
        {
          type: 'labeledArg',
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
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta

    const { node: callExpression } = nodeMeta
    const angle = roundOff(getAngle(from, to), 0)

    const intersectTag = findKwArg(ARG_INTERSECT_TAG, callExpression)
    if (intersectTag === undefined) {
      return new Error(
        `no ${ARG_INTERSECT_TAG} argument found in angledLineThatIntersect call, which requires it`
      )
    }
    const intersectTagName =
      intersectTag.type === 'Name' ? intersectTag.name.name : ''
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

    mutateKwArg(ARG_ANGLE, callExpression, createLiteral(angle))
    mutateKwArg(ARG_OFFSET, callExpression, createLiteral(offset))
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getTag: getTagKwArg(),
  addTag: addTagKw(),
  getConstraintInfo: (callExp: CallExpressionKw, code, pathToNode) => {
    if (callExp.type !== 'CallExpressionKw') return []
    const angle = findKwArgWithIndex(ARG_ANGLE, callExp)
    const offset = findKwArgWithIndex(ARG_OFFSET, callExp)
    const intersectTag = findKwArgWithIndex(ARG_INTERSECT_TAG, callExp)
    const returnVal = []
    const pathToBase: PathToNode = [
      ...pathToNode,
      ['arguments', 'CallExpressionKw'],
    ]
    if (angle !== undefined) {
      const pathToAngleProp: PathToNode = [
        ...pathToBase,
        [angle.argIndex, ARG_INDEX_FIELD],
        ['arg', LABELED_ARG_FIELD],
      ]
      returnVal.push(
        constrainInfo(
          'angle',
          isNotLiteralArrayOrStatic(angle.expr),
          code.slice(angle.expr.start, angle.expr.end),
          'angledLineThatIntersects',
          { type: 'labeledArg', key: 'angle' },
          topLevelRange(angle.expr.start, angle.expr.end),
          pathToAngleProp
        )
      )
    }
    if (intersectTag !== undefined) {
      const pathToTagProp: PathToNode = [
        ...pathToBase,
        [intersectTag.argIndex, ARG_INDEX_FIELD],
        ['arg', LABELED_ARG_FIELD],
      ]
      const info = constrainInfo(
        'intersectionTag',
        // This will always be a tag identifier.
        false,
        code.slice(intersectTag.expr.start, intersectTag.expr.end),
        'angledLineThatIntersects',
        { type: 'labeledArg', key: 'intersectTag' },
        topLevelRange(intersectTag.expr.start, intersectTag.expr.end),
        pathToTagProp
      )
      returnVal.push(info)
    }
    if (offset !== undefined) {
      const pathToOffsetProp: PathToNode = [
        ...pathToBase,
        [offset.argIndex, ARG_INDEX_FIELD],
        ['arg', LABELED_ARG_FIELD],
      ]
      returnVal.push(
        constrainInfo(
          'intersectionOffset',
          isNotLiteralArrayOrStatic(offset.expr),
          code.slice(offset.expr.start, offset.expr.end),
          'angledLineThatIntersects',
          { type: 'labeledArg', key: 'offset' },
          topLevelRange(offset.expr.start, offset.expr.end),
          pathToOffsetProp
        )
      )
    }
    return returnVal
  },
}

export const updateStartProfileAtArgs: SketchLineHelperKw['updateArgs'] = ({
  node,
  pathToNode,
  input,
}) => {
  if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
  const { to } = input
  const _node = { ...node }
  const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
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
        preComments: [],
        commentStart: 0,
      },
      pathToNode,
    }
  }

  const { node: callExpression } = nodeMeta
  const toArrExp = createArrayExpression([
    createLiteral(roundOff(to[0])),
    createLiteral(roundOff(to[1])),
  ])

  mutateKwArg(ARG_AT, callExpression, toArrExp)
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

export const sketchLineHelperMapKw: { [key: string]: SketchLineHelperKw } = {
  arc,
  arcTo,
  line,
  lineTo,
  circleThreePoint,
  circle,
  xLine,
  yLine,
  xLineTo,
  yLineTo,
  angledLine,
  angledLineOfXLength,
  angledLineOfYLength,
  angledLineThatIntersects,
  angledLineToX,
  angledLineToY,
  tangentialArc,
  tangentialArcTo,
  startProfile,
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
  const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, thePath)
  if (err(nodeMeta)) return nodeMeta

  const { node: callExpression, shallowPath } = nodeMeta

  const fnName = callExpression?.callee?.name.name
  if (fnName in sketchLineHelperMapKw) {
    const correctFnName =
      callExpression.type === 'CallExpressionKw'
        ? fnNameToTooltip(allLabels(callExpression), fnName)
        : fnName
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
 * Converts a function name to a ToolTip (UI hint/identifier) based on the segment type.
 *
 * This function differs from fnNameToTooltip() in that it uses the Path/segment
 * type information to determine the correct ToolTip, rather than analyzing function
 * argument labels. This is particularly important for functions like 'arc' where
 * the same function name can map to different ToolTips ('arc' or 'arcTo') depending
 * on the segment type (ArcThreePoint vs other types).
 *
 * While fnNameToTooltip() determines the ToolTip by examining the function's argument
 * structure at call site, this function uses the segment geometry information, making
 * it suitable for contexts where we have the Path object but not the full argument list.
 *
 * @param seg - The Path object containing segment type information
 * @param fnName - The function name to convert to a ToolTip
 * @returns The corresponding ToolTip or an Error if the function name is unknown
 */
export function fnNameToToolTipFromSegment(
  seg: Path,
  fnName: string
): ToolTip | Error {
  switch (fnName) {
    case 'arcTo':
    case 'arc': {
      return seg.type === 'ArcThreePoint' ? 'arcTo' : 'arc'
    }
    case 'line':
    case 'lineTo':
    case 'xLine':
    case 'xLineTo':
    case 'yLine':
    case 'yLineTo':
    case 'angledLineToX':
    case 'angledLineToY':
    case 'angledLineOfXLength':
    case 'angledLineOfYLength':
    case 'angledLineThatIntersects':
    case 'circleThreePoint':
    case 'circle':
    case 'tangentialArc':
    case 'tangentialArcTo':
    case 'angledLine':
    case 'startProfile':
    case 'arcTo':
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
export function fnNameToTooltip(
  argLabels: string[],
  fnName: string
): ToolTip | Error {
  const isAbsolute = argLabels.some((label) => label === ARG_END_ABSOLUTE)
  switch (fnName) {
    case 'arc': {
      const isArc = argLabels.some((label) =>
        [ARG_RADIUS, ARG_ANGLE_START, ARG_ANGLE_END].includes(label)
      )
      return isArc ? 'arc' : 'arcTo'
    }
    case 'line':
      return isAbsolute ? 'lineTo' : 'line'
    case 'xLine':
      return isAbsolute ? 'xLineTo' : 'xLine'
    case 'yLine':
      return isAbsolute ? 'yLineTo' : 'yLine'
    case 'tangentialArc':
      return isAbsolute ? 'tangentialArcTo' : 'tangentialArc'
    case 'angledLineThatIntersects':
    case 'circleThreePoint':
    case 'circle':
    case 'startProfile':
      return fnName
    case 'angledLine': {
      const argmap: Record<string, ToolTip> = {
        [ARG_LENGTH_X]: 'angledLineOfXLength',
        [ARG_LENGTH_Y]: 'angledLineOfYLength',
        [ARG_END_ABSOLUTE_X]: 'angledLineToX',
        [ARG_END_ABSOLUTE_Y]: 'angledLineToY',
        [ARG_LENGTH]: 'angledLine',
      }
      for (const [arg, tooltip] of Object.entries(argmap)) {
        const foundAt = argLabels.findIndex((label) => label === arg)
        if (foundAt >= 0) {
          return tooltip
        }
      }
      const err = `Unknown angledLine arguments, could not map to tooltip. Args were ${argLabels}`
      console.error(err)
      return new Error(err)
    }
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
    case 'tangentialArc':
      return tooltip
    case 'lineTo':
      return 'line'
    case 'xLineTo':
      return 'xLine'
    case 'yLineTo':
      return 'yLine'
    case 'tangentialArcTo':
      return 'tangentialArc'
    case 'angledLine':
    case 'angledLineToX':
    case 'angledLineToY':
    case 'angledLineOfXLength':
    case 'angledLineOfYLength':
      return 'angledLine'
    default:
      return new Error(`Unknown tooltip function ${tooltip}`)
  }
}

export function getConstraintInfoKw(
  callExpression: Node<CallExpressionKw>,
  code: string,
  pathToNode: PathToNode,
  filterValue?: string
): ConstrainInfo[] {
  const fnName = callExpression?.callee?.name.name || ''
  const isAbsolute = isAbsoluteLine(callExpression)
  if (err(isAbsolute)) {
    console.error(
      `Could not tell if this call to ${fnName} was absolute`,
      isAbsolute
    )
    return []
  }
  if (!(fnName in sketchLineHelperMapKw)) return []
  const tooltip = fnNameToTooltip(allLabels(callExpression), fnName)
  if (err(tooltip)) {
    console.error(tooltip)
    return []
  }
  return sketchLineHelperMapKw[tooltip].getConstraintInfo(
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
  snaps?: addCall['snaps']
}

export function addNewSketchLn({
  node: _node,
  variables,
  fnName,
  pathToNode,
  input: segmentInput,
  spliceBetween = false,
  snaps,
}: CreateLineFnCallArgs):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  const node = structuredClone(_node)
  const { add, updateArgs } = sketchLineHelperMapKw?.[fnName] || {}
  if (!add || !updateArgs) {
    return new Error(`${fnName} is not a sketch line helper`)
  }

  getNodeFromPath<Node<VariableDeclarator>>(
    node,
    pathToNode,
    'VariableDeclarator'
  )
  getNodeFromPath<Node<PipeExpression | CallExpressionKw>>(
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
    snaps,
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
  expressions: Node<CallExpressionKw>[]
}) {
  const _node: Node<Program> = structuredClone(node)
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
  node: Node<Program>
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

  const { add } = sketchLineHelperMapKw[fnName]
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
      tag.type === 'Name' &&
      tag.name.name === edgeCutMeta.tagName
    if (elementMatchesBaseTagType) return true

    // e.g. chamfer(tags: [getOppositeEdge(tagOfInterest), tag2])
    //                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    const tagMatchesOppositeTagType =
      edgeCutMeta?.subType === 'opposite' &&
      tag.type === 'CallExpressionKw' &&
      tag.callee.name.name === 'getOppositeEdge' &&
      tag.unlabeled?.type === 'Name' &&
      tag.unlabeled.name.name === edgeCutMeta.tagName
    if (tagMatchesOppositeTagType) return true

    // e.g. chamfer(tags: [getNextAdjacentEdge(tagOfInterest), tag2])
    //                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    const tagMatchesAdjacentTagType =
      edgeCutMeta?.subType === 'adjacent' &&
      tag.type === 'CallExpressionKw' &&
      (tag.callee.name.name === 'getNextAdjacentEdge' ||
        tag.callee.name.name === 'getPrevAdjacentEdge') &&
      tag.unlabeled?.type === 'Name' &&
      tag.unlabeled.name.name === edgeCutMeta.tagName
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
  return new Error(`"${expressionName}" is not a sketch line helper`)
}

function isAngleLiteral(lineArgument: Expr): boolean {
  return isLiteralArrayOrStatic(lineArgument)
}

type addTagFn = (
  a: AddTagInfo
) => { modifiedAst: Node<Program>; tag: string } | Error

function addTagKw(): addTagFn {
  return ({ node, pathToNode }) => {
    const _node = { ...node }
    // We have to allow for the possibility that the path is actually to a call expression.
    // That's because if the parser reads something like `close()`, it doesn't know if this
    // is a keyword or positional call.
    // In fact, even something like `close(%)` could be either (because we allow 1 unlabeled
    // starting param).
    const callExpr = getNodeFromPath<Node<CallExpressionKw>>(
      _node,
      pathToNode,
      ['CallExpressionKw']
    )
    if (err(callExpr)) return callExpr

    // If the original node is a call expression, we'll need to change it to a call with keyword args.
    const primaryCallExp: CallExpressionKw = callExpr.node
    const tagArg = findKwArg(ARG_TAG, primaryCallExp)
    const tagDeclarator =
      tagArg || createTagDeclarator(findUniqueName(_node, 'seg', 2))
    const isTagExisting = !!tagArg
    if (!isTagExisting) {
      const labeledArg = createLabeledArg(ARG_TAG, tagDeclarator)
      if (primaryCallExp.arguments === undefined) {
        primaryCallExp.arguments = []
      }
      primaryCallExp.arguments.push(labeledArg)
    }

    // If we changed the node, we must replace the old node with the new node in the AST.
    const mustReplaceNode = primaryCallExp.type !== callExpr.node.type
    if (mustReplaceNode) {
      getNodeFromPath(_node, pathToNode, ['CallExpressionKw'], false, false, {
        ...primaryCallExp,
        start: callExpr.node.start,
        end: callExpr.node.end,
        moduleId: callExpr.node.moduleId,
        outerAttrs: callExpr.node.outerAttrs,
        commentStart: callExpr.node.start,
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

export const getAngledLine = (
  callExp: CallExpressionKw
):
  | {
      val: [Expr, Expr]
      tag?: Expr
    }
  | Error => {
  let angle = findKwArg(ARG_ANGLE, callExp)
  let length = findKwArgAny(
    [
      ARG_LENGTH,
      ARG_LENGTH_X,
      ARG_LENGTH_Y,
      ARG_END_ABSOLUTE_X,
      ARG_END_ABSOLUTE_Y,
    ],
    callExp
  )
  let tag = findKwArg(ARG_TAG, callExp)
  if (angle && length) {
    return { val: [angle, length], tag }
  }
  return new Error('malformed angled line call!')
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
    let radiusInfo = findKwArgWithIndex(ARG_RADIUS, callExp)
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

export const getAngledLineThatIntersects = (
  callExp: CallExpressionKw
):
  | {
      val: [Expr, Expr, Expr]
      tag?: Expr
    }
  | Error => {
  const angle = findKwArg(ARG_ANGLE, callExp)
  const intersectTag = findKwArg(ARG_INTERSECT_TAG, callExp)
  const offset = findKwArg(ARG_OFFSET, callExp)
  if (!angle || !intersectTag || !offset) {
    return new Error(
      `angledLineThatIntersects call needs angle, intersectTag, and offset args`
    )
  }
  const tag = findKwArg(ARG_TAG, callExp)
  return { val: [angle, intersectTag, offset], tag }
}

export const getArc = (
  callExp: CallExpressionKw
):
  | {
      val: [Expr, Expr, Expr] | [Expr, Expr]
      tag?: Expr
    }
  | Error => {
  const angleStart = findKwArg(ARG_ANGLE_START, callExp)
  const angleEnd = findKwArg(ARG_ANGLE_END, callExp)
  const radius = findKwArg(ARG_RADIUS, callExp)
  const isMissingAnyAngleKwArgs = !angleStart || !angleEnd || !radius

  const interiorAbsolute = findKwArg(ARG_INTERIOR_ABSOLUTE, callExp)
  const endAbsolute = findKwArg(ARG_END_ABSOLUTE, callExp)
  const isMissingAnyEndKwArgs = !interiorAbsolute || !endAbsolute

  if (!isMissingAnyAngleKwArgs) {
    const tag = findKwArg(ARG_TAG, callExp)
    return { val: [angleStart, angleEnd, radius], tag }
  } else if (!isMissingAnyEndKwArgs) {
    const tag = findKwArg(ARG_TAG, callExp)
    return { val: [interiorAbsolute, endAbsolute], tag }
  }

  return new Error(
    `arc call needs [angleStart, angleEnd, radius] or [interiorAbsolute, endAbsolute] args`
  )
}

export const getStartProfile = (
  callExp: CallExpressionKw
):
  | {
      val: [Expr, Expr]
      tag?: Expr
    }
  | Error => {
  const absoluteCoords = findKwArg('at', callExp)
  const tag = findKwArg(ARG_TAG, callExp)
  if (absoluteCoords) {
    if (absoluteCoords.type === 'ArrayExpression') {
      console.log('absoluteCoords', absoluteCoords)
      return {
        val: [absoluteCoords.elements[0], absoluteCoords.elements[1]],
        tag,
      }
    }
  }
  return new Error('expected the arguments to be for a start profile')
}

/**
Given a line call, return whether it's using absolute or relative end.
*/
export function isAbsoluteLine(lineCall: CallExpressionKw): boolean | Error {
  const name = lineCall?.callee?.name.name
  switch (name) {
    case 'line':
      if (findKwArg(ARG_END, lineCall) !== undefined) {
        return false
      }
      if (findKwArg(ARG_END_ABSOLUTE, lineCall) !== undefined) {
        return true
      }
      return new Error(
        `${name} call has neither ${ARG_END} nor ${ARG_END_ABSOLUTE} params`
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
    case 'tangentialArc':
      return findKwArg(ARG_END_ABSOLUTE, lineCall) !== undefined
    case 'angledLineThatIntersects':
    case 'arc':
    case 'circle':
    case 'circleThreePoint':
      return false
    case 'angledLine':
      return (
        findKwArgAny([ARG_END_ABSOLUTE_X, ARG_END_ABSOLUTE_Y], lineCall) !==
        undefined
      )
    case 'startProfile':
      return true
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
  const name = lineCall?.callee?.name.name

  switch (name) {
    case 'circle':
      return getCircle(lineCall)
    case 'tangentialArc':
    case 'line': {
      const arg = findKwArgAny(DETERMINING_ARGS, lineCall)
      if (arg === undefined) {
        return new Error("no end of the line was found in fn '" + name + "'")
      }
      return getValuesForXYFns(arg)
    }
    case 'angledLineThatIntersects':
      return getAngledLineThatIntersects(lineCall)
    case 'arc':
      return getArc(lineCall)
    case 'startProfile':
      return getStartProfile(lineCall)
    case 'yLine':
    case 'xLine': {
      const arg = findKwArgAny(DETERMINING_ARGS, lineCall)
      const tag = findKwArg(ARG_TAG, lineCall)
      if (arg === undefined) {
        return new Error("no end of the line was found in fn '" + name + "'")
      } else {
        return { val: arg, tag }
      }
    }
    case 'angledLine': {
      const angle = findKwArg(ARG_ANGLE, lineCall)
      if (angle === undefined) {
        return new Error(`call to ${name} needs an ${ARG_ANGLE} arg`)
      }
      const length = findKwArgAny(
        [
          ARG_LENGTH,
          ARG_LENGTH_X,
          ARG_LENGTH_Y,
          ARG_END_ABSOLUTE_X,
          ARG_END_ABSOLUTE_Y,
        ],
        lineCall
      )
      if (length === undefined) {
        return new Error(
          `call to ${name} needs an arg like ${ARG_LENGTH}, or ${ARG_END_ABSOLUTE_X} or something`
        )
      }
      const tag = findKwArg(ARG_TAG, lineCall)
      return { val: [angle, length], tag }
    }
    default:
      return new Error(`unknown function ${name}`)
  }
}

/** A determining arg is one that determines the line, e.g. for xLine it's either 'length' or 'endAbsolute'
 */
function removeDeterminingArgs(callExp: CallExpressionKw) {
  removeKwArgs(DETERMINING_ARGS, callExp)
}

const tangentialArcHelpers = {
  add: ({
    node,
    pathToNode,
    segmentInput,
    replaceExistingCallback,
    isAbsolute = false,
  }: {
    node: Node<Program>
    pathToNode: PathToNode
    segmentInput: SegmentInputs
    replaceExistingCallback?: (
      rawArgs: RawArgs
    ) => CreatedSketchExprResult | Error
    isAbsolute?: boolean
  }) => {
    if (segmentInput.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
    const { to, from } = segmentInput
    const _node = { ...node }
    const getNode = getNodeFromPathCurry(_node, pathToNode)
    const _node1 = getNode<PipeExpression | CallExpressionKw>('PipeExpression')
    if (err(_node1)) return _node1
    const { node: pipe } = _node1
    const _node2 = getNodeFromPath<VariableDeclarator>(
      _node,
      pathToNode,
      'VariableDeclarator'
    )
    if (err(_node2)) return _node2
    const { node: varDec } = _node2

    const toX = createLiteral(roundOff(isAbsolute ? to[0] : to[0] - from[0], 2))
    const toY = createLiteral(roundOff(isAbsolute ? to[1] : to[1] - from[1], 2))

    const argLabel = isAbsolute ? ARG_END_ABSOLUTE : ARG_END
    const xArgType = isAbsolute ? 'xAbsolute' : 'xRelative'
    const yArgType = isAbsolute ? 'yAbsolute' : 'yRelative'

    if (replaceExistingCallback && pipe.type !== 'CallExpressionKw') {
      const { index: callIndex } = splitPathAtPipeExpression(pathToNode)
      const result = replaceExistingCallback([
        {
          type: 'labeledArgArrayItem',
          key: argLabel,
          index: 0,
          argType: xArgType,
          expr: toX,
        },
        {
          type: 'labeledArgArrayItem',
          key: argLabel,
          index: 1,
          argType: yArgType,
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
    const newLine = createCallExpressionStdLibKw(
      'tangentialArc',
      null, // Assumes this is being called in a pipeline, so the first arg is optional and if not given, will become pipeline substitution.
      [createLabeledArg(argLabel, createArrayExpression([toX, toY]))]
    )
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
          [pipe.body.length - 1, 'CallExpressionKw'],
        ] as PathToNode,
      }
    } else {
      varDec.init = createPipeExpression([varDec.init, newLine])
    }
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  update: ({
    node,
    pathToNode,
    input,
    isAbsolute = false,
  }: {
    node: Node<Program>
    pathToNode: PathToNode
    input: SegmentInputs
    isAbsolute?: boolean
  }) => {
    if (input.type !== 'straight-segment') return STRAIGHT_SEGMENT_ERR()
    const { to, from } = input
    const _node = { ...node }
    const nodeMeta = getNodeFromPath<CallExpressionKw>(_node, pathToNode)
    if (err(nodeMeta)) return nodeMeta
    const { node: callExpression } = nodeMeta

    if (callExpression.type !== 'CallExpressionKw') {
      return new Error(
        `Expected CallExpressionKw, but found ${callExpression.type}`
      )
    }

    const argLabel = isAbsolute ? ARG_END_ABSOLUTE : ARG_END
    const functionName = isAbsolute ? 'tangentialArcTo' : 'tangentialArc'

    for (const arg of callExpression.arguments) {
      if (arg.label?.name !== argLabel && arg.label?.name !== ARG_TAG) {
        console.debug(
          `Trying to edit unsupported ${functionName} keyword arguments; skipping`
        )
        return {
          modifiedAst: _node,
          pathToNode,
        }
      }
    }

    const toArrExp = createArrayExpression([
      createLiteral(roundOff(isAbsolute ? to[0] : to[0] - from[0], 2)),
      createLiteral(roundOff(isAbsolute ? to[1] : to[1] - from[1], 2)),
    ])

    mutateKwArg(argLabel, callExpression, toArrExp)
    return {
      modifiedAst: _node,
      pathToNode,
    }
  },
  getConstraintInfo: ({
    callExp,
    code,
    pathToNode,
    isAbsolute = false,
  }: {
    callExp: CallExpressionKw
    code: string
    pathToNode: PathToNode
    isAbsolute?: boolean
  }): ConstrainInfo[] => {
    if (callExp.type !== 'CallExpressionKw') return []
    if (callExp.callee.name.name !== 'tangentialArc') return []

    const callee = callExp.callee
    const pathToCallee: PathToNode = [
      ...pathToNode,
      ['callee', 'CallExpressionKw'],
    ]

    const argLabel = isAbsolute ? ARG_END_ABSOLUTE : ARG_END
    const xConstraintType = isAbsolute ? 'xAbsolute' : 'xRelative'
    const yConstraintType = isAbsolute ? 'yAbsolute' : 'yRelative'

    const endArg = findKwArgWithIndex(argLabel, callExp)

    const constraints: ConstrainInfo[] = [
      constrainInfo(
        'tangentialWithPrevious',
        true,
        callee.name.name,
        'tangentialArc',
        undefined,
        topLevelRange(callee.start, callee.end),
        pathToCallee
      ),
    ]
    if (endArg) {
      const { expr, argIndex } = endArg
      const pathToArgs: PathToNode = [
        ...pathToNode,
        ['arguments', 'CallExpressionKw'],
      ]
      const pathToArg: PathToNode = [
        ...pathToArgs,
        [argIndex, ARG_INDEX_FIELD],
        ['arg', LABELED_ARG_FIELD],
      ]
      if (expr.type !== 'ArrayExpression' || expr.elements.length < 2) {
        constraints.push({
          stdLibFnName: 'tangentialArc',
          type: xConstraintType,
          isConstrained: isNotLiteralArrayOrStatic(expr),
          sourceRange: topLevelRange(expr.start, expr.end),
          pathToNode: pathToArg,
          value: code.slice(expr.start, expr.end),
          argPosition: {
            type: 'labeledArgArrayItem',
            index: 0,
            key: argLabel,
          },
        })
        constraints.push({
          stdLibFnName: 'tangentialArc',
          type: yConstraintType,
          isConstrained: isNotLiteralArrayOrStatic(expr),
          sourceRange: topLevelRange(expr.start, expr.end),
          pathToNode: pathToArg,
          value: code.slice(expr.start, expr.end),
          argPosition: {
            type: 'labeledArgArrayItem',
            index: 1,
            key: argLabel,
          },
        })
        return constraints
      }
      const pathToX: PathToNode = [
        ...pathToArg,
        ['elements', 'ArrayExpression'],
        [0, 'index'],
      ]
      const pathToY: PathToNode = [
        ...pathToArg,
        ['elements', 'ArrayExpression'],
        [1, 'index'],
      ]
      const exprX = expr.elements[0]
      const exprY = expr.elements[1]
      constraints.push({
        stdLibFnName: 'tangentialArc',
        type: xConstraintType,
        isConstrained: isNotLiteralArrayOrStatic(exprX),
        sourceRange: topLevelRange(exprX.start, exprX.end),
        pathToNode: pathToX,
        value: code.slice(exprX.start, exprX.end),
        argPosition: {
          type: 'labeledArgArrayItem',
          index: 0,
          key: argLabel,
        },
      })
      constraints.push({
        stdLibFnName: 'tangentialArc',
        type: yConstraintType,
        isConstrained: isNotLiteralArrayOrStatic(exprY),
        sourceRange: topLevelRange(exprY.start, exprY.end),
        pathToNode: pathToY,
        value: code.slice(exprY.start, exprY.end),
        argPosition: {
          type: 'labeledArgArrayItem',
          index: 1,
          key: argLabel,
        },
      })
    }
    return constraints
  },
}
