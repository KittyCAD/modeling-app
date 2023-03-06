import { TransformCallback } from './stdTypes'
import { Ranges, toolTips, TooTip } from '../../useStore'
import {
  BinaryPart,
  CallExpression,
  Program,
  Value,
  VariableDeclarator,
} from '../abstractSyntaxTree'
import {
  getNodeFromPath,
  getNodeFromPathCurry,
  getNodePathFromSourceRange,
} from '../queryAst'
import {
  createBinaryExpression,
  createCallExpression,
  createLiteral,
  createPipeSubstitution,
  createUnaryExpression,
  giveSketchFnCallTag,
} from '../modifyAst'
import { createFirstArg, getFirstArg, replaceSketchLine } from './sketch'
import { ProgramMemory } from '../executor'
import { getSketchSegmentIndexFromSourceRange } from './sketchConstraints'
import { roundOff } from '../../lib/utils'

type LineInputsType =
  | 'xAbsolute'
  | 'yAbsolute'
  | 'xRelative'
  | 'yRelative'
  | 'angle'
  | 'length'

export type ConstraintType =
  | 'equalLength'
  | 'vertical'
  | 'horizontal'
  | 'equalangle'
  | 'setHorzDistance'
  | 'setVertDistance'

function createCallWrapper(
  a: TooTip,
  val: [Value, Value] | Value,
  tag?: Value,
  valueUsedInTransform?: number
): ReturnType<TransformCallback> {
  return {
    callExp: createCallExpression(a, [
      createFirstArg(a, val, tag),
      createPipeSubstitution(),
    ]),
    valueUsedInTransform,
  }
}

export type TransformInfo = {
  tooltip: TooTip
  createNode: (a: {
    varValA: Value // x / angle
    varValB: Value // y / length or x y for angledLineOfXlength etc
    referenceSegName: string
    tag?: Value
  }) => TransformCallback
}

type TransformMap = {
  [key in TooTip]: {
    [key in LineInputsType | 'free']?: {
      [key in ConstraintType]?: TransformInfo
    }
  }
}

const basicAngledLineCreateNode: TransformInfo['createNode'] =
  ({ referenceSegName, tag }) =>
  (args) =>
    createCallWrapper(
      'angledLine',
      [args[0], createSegLen(referenceSegName)],
      tag
    )
const angledLineAngleCreateNode: TransformInfo['createNode'] =
  ({ referenceSegName, varValA, tag }) =>
  () =>
    createCallWrapper(
      'angledLine',
      [varValA, createSegLen(referenceSegName)],
      tag
    )

const getMinAndSegLenVals = (
  referenceSegName: string,
  varVal: Value
): [Value, BinaryPart] => {
  const segLenVal = createSegLen(referenceSegName)
  return [
    createCallExpression('min', [segLenVal, varVal]),
    createCallExpression('legLen', [segLenVal, varVal]),
  ]
}

const getMinAndSegAngVals = (
  referenceSegName: string,
  varVal: Value,
  fnName: 'legAngX' | 'legAngY' = 'legAngX'
): [Value, BinaryPart] => {
  const minVal = createCallExpression('min', [
    createSegLen(referenceSegName),
    varVal,
  ])
  const legAngle = createCallExpression(fnName, [
    createSegLen(referenceSegName),
    varVal,
  ])
  return [minVal, legAngle]
}

const getSignedLeg = (arg: Value, legLenVal: BinaryPart) =>
  arg.type === 'Literal' && Number(arg.value) < 0
    ? createUnaryExpression(legLenVal)
    : legLenVal

const getLegAng = (arg: Value, legAngleVal: BinaryPart) => {
  const ang = (arg.type === 'Literal' && Number(arg.value)) || 0
  const normalisedAngle = ((ang % 360) + 360) % 360 // between 0 and 360
  const truncatedTo90 = Math.floor(normalisedAngle / 90) * 90
  const binExp = createBinaryExpression([
    createLiteral(truncatedTo90),
    '+',
    legAngleVal,
  ])
  return truncatedTo90 == 0 ? legAngleVal : binExp
}

const getAngleLengthSign = (arg: Value, legAngleVal: BinaryPart) => {
  const ang = (arg.type === 'Literal' && Number(arg.value)) || 0
  const normalisedAngle = ((ang % 180) + 180) % 180 // between 0 and 180
  return normalisedAngle > 90 ? createUnaryExpression(legAngleVal) : legAngleVal
}

const setHorzVertDistanceCreateNode =
  (
    xOrY: 'x' | 'y',
    index = xOrY === 'x' ? 0 : 1
  ): TransformInfo['createNode'] =>
  ({ referenceSegName, tag }) => {
    return (args, referencedSegment) => {
      const valueUsedInTransform = roundOff(
        getArgLiteralVal(args?.[index]) - (referencedSegment?.to?.[index] || 0),
        2
      )
      const makeBinExp = createBinaryExpression([
        createSegEnd(referenceSegName, !index),
        '+',
        createLiteral(valueUsedInTransform),
      ])
      return createCallWrapper(
        'lineTo',
        !index ? [makeBinExp, args[1]] : [args[0], makeBinExp],
        tag,
        valueUsedInTransform
      )
    }
  }

const setHorzVertDistanceConstraintLineCreateNode =
  (isX: boolean): TransformInfo['createNode'] =>
  ({ referenceSegName, tag, varValA, varValB }) => {
    const varVal = (isX ? varValB : varValA) as BinaryPart
    const varValBinExp = createBinaryExpression([
      createLastSeg(!isX),
      '+',
      varVal,
    ])

    return (args, referencedSegment) => {
      const makeBinExp = (index: 0 | 1) => {
        const arg = getArgLiteralVal(args?.[index])
        return createBinaryExpression([
          createSegEnd(referenceSegName, isX),
          '+',
          createLiteral(
            roundOff(arg - (referencedSegment?.to?.[index] || 0), 2)
          ),
        ])
      }
      return createCallWrapper(
        'lineTo',
        isX ? [makeBinExp(0), varValBinExp] : [varValBinExp, makeBinExp(1)],
        tag
      )
    }
  }

const transformMap: TransformMap = {
  line: {
    xRelative: {
      equalLength: {
        tooltip: 'line',
        createNode: ({ referenceSegName, varValA, tag }) => {
          const [minVal, legLenVal] = getMinAndSegLenVals(
            referenceSegName,
            varValA
          )
          return (args) =>
            createCallWrapper(
              'line',
              [minVal, getSignedLeg(args[1], legLenVal)],
              tag
            )
        },
      },
      horizontal: {
        tooltip: 'xLine',
        createNode:
          ({ varValA, tag }) =>
          () =>
            createCallWrapper('xLine', varValA, tag),
      },
      setVertDistance: {
        tooltip: 'lineTo',
        createNode: setHorzVertDistanceConstraintLineCreateNode(false),
      },
    },
    yRelative: {
      equalLength: {
        tooltip: 'line',
        createNode: ({ referenceSegName, varValB, tag }) => {
          const [minVal, legLenVal] = getMinAndSegLenVals(
            referenceSegName,
            varValB
          )
          return (args) =>
            createCallWrapper(
              'line',
              [getSignedLeg(args[0], legLenVal), minVal],
              tag
            )
        },
      },
      vertical: {
        tooltip: 'yLine',
        createNode:
          ({ varValB, tag }) =>
          () =>
            createCallWrapper('yLine', varValB, tag),
      },
      setHorzDistance: {
        tooltip: 'lineTo',
        createNode: setHorzVertDistanceConstraintLineCreateNode(true),
      },
    },
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode,
      },
      horizontal: {
        tooltip: 'xLine',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('xLine', args[0], tag),
      },
      vertical: {
        tooltip: 'yLine',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('yLine', args[1], tag),
      },
      setHorzDistance: {
        tooltip: 'lineTo',
        createNode: setHorzVertDistanceCreateNode('x'),
      },
      setVertDistance: {
        tooltip: 'lineTo',
        createNode: setHorzVertDistanceCreateNode('y'),
      },
    },
  },
  lineTo: {
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode,
      },
      horizontal: {
        tooltip: 'xLineTo',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('xLineTo', args[0], tag),
      },
      vertical: {
        tooltip: 'yLineTo',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('yLineTo', args[1], tag),
      },
    },
    xAbsolute: {
      equalLength: {
        tooltip: 'angledLineToX',
        createNode:
          ({ referenceSegName, varValA, tag }) =>
          (args) => {
            const angleToMatchLengthXCall = createCallExpression(
              'angleToMatchLengthX',
              [
                createLiteral(referenceSegName),
                varValA,
                createPipeSubstitution(),
              ]
            )
            return createCallWrapper(
              'angledLineToX',
              [getAngleLengthSign(args[0], angleToMatchLengthXCall), varValA],
              tag
            )
          },
      },
      horizontal: {
        tooltip: 'xLineTo',
        createNode:
          ({ varValA, tag }) =>
          () =>
            createCallWrapper('xLineTo', varValA, tag),
      },
    },
    yAbsolute: {
      equalLength: {
        tooltip: 'angledLineToY',
        createNode:
          ({ referenceSegName, varValB, tag }) =>
          (args) => {
            const angleToMatchLengthYCall = createCallExpression(
              'angleToMatchLengthY',
              [
                createLiteral(referenceSegName),
                varValB,
                createPipeSubstitution(),
              ]
            )
            return createCallWrapper(
              'angledLineToY',
              [getAngleLengthSign(args[0], angleToMatchLengthYCall), varValB],
              tag
            )
          },
      },
      vertical: {
        tooltip: 'yLineTo',
        createNode:
          ({ varValB, tag }) =>
          () =>
            createCallWrapper('yLineTo', varValB, tag),
      },
    },
  },
  angledLine: {
    angle: {
      equalLength: {
        tooltip: 'angledLine',
        createNode:
          ({ referenceSegName, varValA, tag }) =>
          () =>
            createCallWrapper(
              'angledLine',
              [varValA, createSegLen(referenceSegName)],
              tag
            ),
      },
    },
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode,
      },
      vertical: {
        tooltip: 'yLine',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('yLine', args[1], tag),
      },
      horizontal: {
        tooltip: 'xLine',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('xLine', args[0], tag),
      },
    },
    length: {
      vertical: {
        tooltip: 'yLine',
        createNode:
          ({ varValB, tag }) =>
          ([arg0]) => {
            const val =
              arg0.type === 'Literal' && Number(arg0.value) < 0
                ? createUnaryExpression(varValB as BinaryPart)
                : varValB
            return createCallWrapper('yLine', val, tag)
          },
      },
      horizontal: {
        tooltip: 'xLine',
        createNode:
          ({ varValB, tag }) =>
          ([arg0]) => {
            const val =
              arg0.type === 'Literal' && Number(arg0.value) < 0
                ? createUnaryExpression(varValB as BinaryPart)
                : varValB
            return createCallWrapper('xLine', val, tag)
          },
      },
    },
  },
  angledLineOfXLength: {
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode,
      },
      horizontal: {
        tooltip: 'xLine',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('xLine', args[0], tag),
      },
    },
    angle: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: angledLineAngleCreateNode,
      },
    },
    xRelative: {
      equalLength: {
        tooltip: 'angledLineOfXLength',
        createNode: ({ referenceSegName, varValB, tag }) => {
          const [minVal, legAngle] = getMinAndSegAngVals(
            referenceSegName,
            varValB
          )
          return (args) =>
            createCallWrapper(
              'angledLineOfXLength',
              [getLegAng(args[0], legAngle), minVal],
              tag
            )
        },
      },
      horizontal: {
        tooltip: 'xLine',
        createNode:
          ({ varValB, tag }) =>
          ([arg0]) => {
            const val =
              arg0.type === 'Literal' && Number(arg0.value) < 0
                ? createUnaryExpression(varValB as BinaryPart)
                : varValB
            return createCallWrapper('xLine', val, tag)
          },
      },
    },
  },
  angledLineOfYLength: {
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode,
      },
      vertical: {
        tooltip: 'yLine',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('yLine', args[1], tag),
      },
    },
    angle: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: angledLineAngleCreateNode,
      },
    },
    yRelative: {
      equalLength: {
        tooltip: 'angledLineOfYLength',
        createNode: ({ referenceSegName, varValB, tag }) => {
          const [minVal, legAngle] = getMinAndSegAngVals(
            referenceSegName,
            varValB,
            'legAngY'
          )
          return (args) =>
            createCallWrapper(
              'angledLineOfXLength',
              [getLegAng(args[0], legAngle), minVal],
              tag
            )
        },
      },
      vertical: {
        tooltip: 'yLine',
        createNode:
          ({ varValB, tag }) =>
          ([arg0]) => {
            const val =
              arg0.type === 'Literal' && Number(arg0.value) < 0
                ? createUnaryExpression(varValB as BinaryPart)
                : varValB
            return createCallWrapper('yLine', val, tag)
          },
      },
    },
  },
  angledLineToX: {
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode,
      },
      horizontal: {
        tooltip: 'xLineTo',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('xLineTo', args[0], tag),
      },
    },
    angle: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: angledLineAngleCreateNode,
      },
    },
    xAbsolute: {
      equalLength: {
        tooltip: 'angledLineToX',
        createNode:
          ({ referenceSegName, varValB, tag }) =>
          (args) => {
            const angleToMatchLengthXCall = createCallExpression(
              'angleToMatchLengthX',
              [
                createLiteral(referenceSegName),
                varValB,
                createPipeSubstitution(),
              ]
            )
            return createCallWrapper(
              'angledLineToX',
              [getAngleLengthSign(args[0], angleToMatchLengthXCall), varValB],
              tag
            )
          },
      },
      horizontal: {
        tooltip: 'xLineTo',
        createNode:
          ({ varValB, tag }) =>
          ([arg0]) =>
            createCallWrapper('xLineTo', varValB, tag),
      },
    },
  },
  angledLineToY: {
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode,
      },
      vertical: {
        tooltip: 'yLineTo',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('yLineTo', args[1], tag),
      },
    },
    angle: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: angledLineAngleCreateNode,
      },
    },
    yAbsolute: {
      equalLength: {
        tooltip: 'angledLineToY',
        createNode:
          ({ referenceSegName, varValB, tag }) =>
          (args) => {
            const angleToMatchLengthXCall = createCallExpression(
              'angleToMatchLengthY',
              [
                createLiteral(referenceSegName),
                varValB,
                createPipeSubstitution(),
              ]
            )
            return createCallWrapper(
              'angledLineToY',
              [getAngleLengthSign(args[0], angleToMatchLengthXCall), varValB],
              tag
            )
          },
      },
      vertical: {
        tooltip: 'yLineTo',
        createNode:
          ({ varValB, tag }) =>
          () =>
            createCallWrapper('yLineTo', varValB, tag),
      },
    },
  },
  xLine: {
    free: {
      equalLength: {
        tooltip: 'xLine',
        createNode:
          ({ referenceSegName, tag }) =>
          () =>
            createCallWrapper('xLine', createSegLen(referenceSegName), tag),
      },
    },
  },
  yLine: {
    free: {
      equalLength: {
        tooltip: 'yLine',
        createNode:
          ({ referenceSegName, tag }) =>
          () =>
            createCallWrapper('yLine', createSegLen(referenceSegName), tag),
      },
    },
  },
  xLineTo: {
    free: {
      equalLength: {
        tooltip: 'xLine',
        createNode:
          ({ referenceSegName, tag }) =>
          () =>
            createCallWrapper('xLine', createSegLen(referenceSegName), tag),
      },
    },
  },
  yLineTo: {
    free: {
      equalLength: {
        tooltip: 'yLine',
        createNode:
          ({ referenceSegName, tag }) =>
          () =>
            createCallWrapper('yLine', createSegLen(referenceSegName), tag),
      },
    },
  },
}

export function getTransformMapPath(
  sketchFnExp: CallExpression,
  constraintType: ConstraintType
):
  | {
      toolTip: TooTip
      lineInputType: LineInputsType | 'free'
      constraintType: ConstraintType
    }
  | false {
  const name = sketchFnExp.callee.name as TooTip
  if (!toolTips.includes(name)) {
    return false
  }

  // check if the function is locked down and so can't be transformed
  const firstArg = getFirstArg(sketchFnExp)
  if (Array.isArray(firstArg.val)) {
    const [a, b] = firstArg.val
    if (a?.type !== 'Literal' && b?.type !== 'Literal') {
      return false
    }
  } else {
    if (firstArg.val?.type !== 'Literal') {
      return false
    }
  }

  // check if the function has no constraints
  const isTwoValFree =
    Array.isArray(firstArg.val) &&
    firstArg.val?.[0]?.type === 'Literal' &&
    firstArg.val?.[1]?.type === 'Literal'
  const isOneValFree =
    !Array.isArray(firstArg.val) && firstArg.val?.type === 'Literal'
  if (isTwoValFree || isOneValFree) {
    const info = transformMap?.[name]?.free?.[constraintType]
    if (info)
      return {
        toolTip: name,
        lineInputType: 'free',
        constraintType,
      }
    // if (info) return info
  }

  // check what constraints the function has
  const lineInputType = getConstraintType(firstArg.val, name)
  if (lineInputType) {
    const info = transformMap?.[name]?.[lineInputType]?.[constraintType]
    if (info)
      return {
        toolTip: name,
        lineInputType,
        constraintType,
      }
    // if (info) return info
  }

  return false
}

export function getTransformInfo(
  sketchFnExp: CallExpression,
  constraintType: ConstraintType
): TransformInfo | false {
  const path = getTransformMapPath(sketchFnExp, constraintType)
  if (!path) return false
  const { toolTip, lineInputType, constraintType: _constraintType } = path
  const info = transformMap?.[toolTip]?.[lineInputType]?.[_constraintType]
  if (!info) return false
  return info
}

export function getConstraintType(
  val: Value | [Value, Value],
  fnName: TooTip
): LineInputsType | null {
  // this function assumes that for two val sketch functions that one arg is locked down not both
  // and for one val sketch functions that the arg is NOT locked down
  // these conditions should have been checked previously.
  // completely locked down or not locked down at all does not depend on the fnName so we can check that first
  const isArr = Array.isArray(val)
  if (!isArr) {
    if (fnName === 'xLine') return 'yRelative'
    if (fnName === 'yLine') return 'xRelative'
    if (fnName === 'xLineTo') return 'yAbsolute'
    if (fnName === 'yLineTo') return 'xAbsolute'
  } else {
    const isFirstArgLockedDown = val?.[0]?.type !== 'Literal'
    if (fnName === 'line')
      return isFirstArgLockedDown ? 'xRelative' : 'yRelative'
    if (fnName === 'lineTo')
      return isFirstArgLockedDown ? 'xAbsolute' : 'yAbsolute'
    if (fnName === 'angledLine')
      return isFirstArgLockedDown ? 'angle' : 'length'
    if (fnName === 'angledLineOfXLength')
      return isFirstArgLockedDown ? 'angle' : 'xRelative'
    if (fnName === 'angledLineToX')
      return isFirstArgLockedDown ? 'angle' : 'xAbsolute'
    if (fnName === 'angledLineOfYLength')
      return isFirstArgLockedDown ? 'angle' : 'yRelative'
    if (fnName === 'angledLineToY')
      return isFirstArgLockedDown ? 'angle' : 'yAbsolute'
  }
  return null
}

export function getTransformInfos(
  selectionRanges: Ranges,
  ast: Program,
  constraintType: ConstraintType
): TransformInfo[] {
  const paths = selectionRanges.map((selectionRange) =>
    getNodePathFromSourceRange(ast, selectionRange)
  )
  const nodes = paths.map(
    (pathToNode) => getNodeFromPath<Value>(ast, pathToNode).node
  )

  const theTransforms = nodes.map((node) => {
    if (node?.type === 'CallExpression')
      return getTransformInfo(node, constraintType)

    return false
  }) as TransformInfo[]
  return theTransforms
}

export function transformSecondarySketchLinesTagFirst({
  ast,
  selectionRanges,
  transformInfos,
  programMemory,
}: {
  ast: Program
  selectionRanges: Ranges
  transformInfos: TransformInfo[]
  programMemory: ProgramMemory
}): {
  modifiedAst: Program
  valueUsedInTransform?: number
  tagInfo: {
    tag: string
    isTagExisting: boolean
  }
} {
  // let node = JSON.parse(JSON.stringify(ast))
  const primarySelection = selectionRanges[0]

  const { modifiedAst, tag, isTagExisting } = giveSketchFnCallTag(
    ast,
    primarySelection
  )

  return {
    ...transformAstSketchLines({
      ast: modifiedAst,
      selectionRanges: selectionRanges.slice(1),
      transformInfos,
      programMemory,
      referenceSegName: tag,
    }),
    tagInfo: {
      tag,
      isTagExisting,
    },
  }
}

export function transformAstSketchLines({
  ast,
  selectionRanges,
  transformInfos,
  programMemory,
  referenceSegName,
}: {
  ast: Program
  selectionRanges: Ranges
  transformInfos: TransformInfo[]
  programMemory: ProgramMemory
  referenceSegName: string
}): { modifiedAst: Program; valueUsedInTransform?: number } {
  // deep clone since we are mutating in a loop, of which any could fail
  let node = JSON.parse(JSON.stringify(ast))
  let _valueUsedInTransform // TODO should this be an array?

  selectionRanges.forEach((range, index) => {
    const callBack = transformInfos?.[index].createNode
    const transformTo = transformInfos?.[index].tooltip
    if (!callBack || !transformTo) throw new Error('no callback helper')

    const getNode = getNodeFromPathCurry(
      node,
      getNodePathFromSourceRange(node, range)
    )

    const callExp = getNode<CallExpression>('CallExpression')?.node
    const varDec = getNode<VariableDeclarator>('VariableDeclarator').node

    const { val, tag: callBackTag } = getFirstArg(callExp)
    const [varValA, varValB] = Array.isArray(val) ? val : [val, val]

    const varName = varDec.id.name
    const sketchGroup = programMemory.root?.[varName]
    if (!sketchGroup || sketchGroup.type !== 'sketchGroup')
      throw new Error('not a sketch group')
    const seg = getSketchSegmentIndexFromSourceRange(sketchGroup, range)
    const referencedSegment = sketchGroup.value.find(
      (path) => path.name === referenceSegName
    )
    const { to, from } = seg
    const { modifiedAst, valueUsedInTransform } = replaceSketchLine({
      node: node,
      programMemory,
      sourceRange: range,
      referencedSegment,
      fnName: transformTo || (callExp.callee.name as TooTip),
      to,
      from,
      createCallback: callBack({
        referenceSegName,
        varValA,
        varValB,
        tag: callBackTag,
      }),
    })

    node = modifiedAst
    if (typeof valueUsedInTransform === 'number') {
      _valueUsedInTransform = valueUsedInTransform
    }
  })
  return { modifiedAst: node, valueUsedInTransform: _valueUsedInTransform }
}

function createSegLen(referenceSegName: string): Value {
  return createCallExpression('segLen', [
    createLiteral(referenceSegName),
    createPipeSubstitution(),
  ])
}

function createSegEnd(referenceSegName: string, isX: boolean): CallExpression {
  return createCallExpression(isX ? 'segEndX' : 'segEndY', [
    createLiteral(referenceSegName),
    createPipeSubstitution(),
  ])
}

function createLastSeg(isX: boolean): CallExpression {
  return createCallExpression(isX ? 'lastSegX' : 'lastSegY', [
    createPipeSubstitution(),
  ])
}

function getArgLiteralVal(arg: Value): number {
  return arg?.type === 'Literal' ? Number(arg.value) : 0
}
