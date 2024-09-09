import {
  SegmentInput,
  SimplifiedArgDetails,
  TransformCallback,
} from './stdTypes'
import { ToolTip, toolTips } from 'lang/langHelpers'
import { Selections, Selection } from 'lib/selections'
import { cleanErrs, err } from 'lib/trap'
import {
  CallExpression,
  Program,
  Expr,
  BinaryPart,
  VariableDeclarator,
  PathToNode,
  ProgramMemory,
  sketchGroupFromKclValue,
} from '../wasm'
import {
  getNodeFromPath,
  getNodeFromPathCurry,
  getNodePathFromSourceRange,
  isValueZero,
} from '../queryAst'
import {
  createArrayExpression,
  createBinaryExpression,
  createBinaryExpressionWithUnary,
  createCallExpression,
  createIdentifier,
  createLiteral,
  createObjectExpression,
  createPipeSubstitution,
  createUnaryExpression,
  giveSketchFnCallTag,
} from '../modifyAst'
import {
  createFirstArg,
  getConstraintInfo,
  getFirstArg,
  replaceSketchLine,
} from './sketch'
import {
  getSketchSegmentFromPathToNode,
  getSketchSegmentFromSourceRange,
} from './sketchConstraints'
import { getAngle, roundOff, normaliseAngle } from '../../lib/utils'

export type LineInputsType =
  | 'xAbsolute'
  | 'yAbsolute'
  | 'xRelative'
  | 'yRelative'
  | 'angle'
  | 'length'
  | 'intersectionOffset'
  | 'intersectionTag'

export type ConstraintType =
  | 'equalLength'
  | 'vertical'
  | 'horizontal'
  | 'equalAngle'
  | 'setHorzDistance'
  | 'setVertDistance'
  | 'setAngle'
  | 'setLength'
  | 'intersect'
  | 'removeConstrainingValues'
  | 'xAbs'
  | 'yAbs'
  | 'setAngleBetween'

function createCallWrapper(
  tooltip: ToolTip,
  val: [Expr, Expr] | Expr,
  tag?: Expr,
  valueUsedInTransform?: number
): ReturnType<TransformCallback> {
  const args =
    tooltip === 'circle'
      ? []
      : [createFirstArg(tooltip, val), createPipeSubstitution()]
  if (tag) {
    args.push(tag)
  }

  const [hasErr, argsWOutErr] = cleanErrs(args)
  if (hasErr) {
    console.error(args)
    return {
      callExp: createCallExpression('', []),
      valueUsedInTransform: 0,
    }
  }

  return {
    callExp: createCallExpression(tooltip, argsWOutErr),
    valueUsedInTransform,
  }
}

/**
 * Abstracts creation of a callExpression ready for use for a sketchCombo transform
 * Assume it exists within a pipe and adds the pipe substitution
 * @param tool line, lineTo, angledLine, etc
 * @param val The first argument to the function
 * @param tag
 * @param valueUsedInTransform
 * @returns
 */
function createStdlibCallExpression(
  tool: ToolTip,
  val: Expr,
  tag?: Expr,
  valueUsedInTransform?: number
): ReturnType<TransformCallback> {
  const args = [val, createPipeSubstitution()]
  if (tag) {
    args.push(tag)
  }
  return {
    callExp: createCallExpression(tool, args),
    valueUsedInTransform,
  }
}

function intersectCallWrapper({
  fnName,
  angleVal,
  offsetVal,
  intersectTag,
  tag,
  valueUsedInTransform,
}: {
  fnName: string
  angleVal: Expr
  offsetVal: Expr
  intersectTag: Expr
  tag?: Expr
  valueUsedInTransform?: number
}): ReturnType<TransformCallback> {
  const firstArg: any = {
    angle: angleVal,
    offset: offsetVal,
    intersectTag,
  }
  const args: Expr[] = [
    createObjectExpression(firstArg),
    createPipeSubstitution(),
  ]
  if (tag) {
    args.push(tag)
  }
  return {
    callExp: createCallExpression(fnName, args),
    valueUsedInTransform,
  }
}

export type TransformInfo = {
  tooltip: ToolTip
  createNode: (a: {
    inputs: SegmentInput[]
    referenceSegName: string
    tag?: Expr
    forceValueUsedInTransform?: Expr
  }) => TransformCallback
}

type TransformMap = {
  [key in ToolTip]?: {
    [key in LineInputsType | 'free']?: {
      [key in ConstraintType]?: TransformInfo
    }
  }
}

const xyLineSetLength =
  (
    xOrY: 'xLine' | 'yLine',
    referenceSeg = false
  ): TransformInfo['createNode'] =>
  ({ referenceSegName, tag, forceValueUsedInTransform }) =>
  (args) => {
    const segRef = createSegLen(referenceSegName)
    const lineVal = forceValueUsedInTransform
      ? forceValueUsedInTransform
      : referenceSeg
      ? segRef
      : args[0].varExpression
    return createCallWrapper(
      xOrY,
      lineVal,
      tag,
      getArgLiteralVal(args[0].varExpression)
    )
  }

const basicAngledLineCreateNode =
  (
    referenceSeg: 'ang' | 'len' | 'none' = 'none',
    valToForce: 'ang' | 'len' | 'none' = 'none',
    varValToUse: 'ang' | 'len' | 'none' = 'none'
  ): TransformInfo['createNode'] =>
  (
    { referenceSegName, tag, forceValueUsedInTransform, inputs } //, varValA, varValB }) =>
  ) =>
  (args, path) => {
    const refAng = path ? getAngle(path?.from, path?.to) : 0
    const nonForcedAng =
      varValToUse === 'ang'
        ? inputs[0].varExpression
        : referenceSeg === 'ang'
        ? getClosesAngleDirection(
            args[0].varExpression,
            refAng,
            createSegAngle(referenceSegName) as BinaryPart
          )
        : args[0].varExpression
    const nonForcedLen =
      varValToUse === 'len'
        ? inputs[1].varExpression
        : referenceSeg === 'len'
        ? createSegLen(referenceSegName)
        : args[1].varExpression
    const shouldForceAng = valToForce === 'ang' && forceValueUsedInTransform
    const shouldForceLen = valToForce === 'len' && forceValueUsedInTransform
    return createCallWrapper(
      'angledLine',
      [
        shouldForceAng ? forceValueUsedInTransform : nonForcedAng,
        shouldForceLen ? forceValueUsedInTransform : nonForcedLen,
      ],
      tag,
      getArgLiteralVal(
        valToForce === 'ang' ? args[0].varExpression : args[1].varExpression
      )
    )
  }
const angledLineAngleCreateNode: TransformInfo['createNode'] =
  ({ referenceSegName, inputs, tag }) =>
  () =>
    createCallWrapper(
      'angledLine',
      [inputs[0].varExpression, createSegLen(referenceSegName)],
      tag
    )

const getMinAndSegLenVals = (
  referenceSegName: string,
  varVal: Expr
): [Expr, BinaryPart] => {
  const segLenVal = createSegLen(referenceSegName)
  return [
    createCallExpression('min', [segLenVal, varVal]),
    createCallExpression('legLen', [segLenVal, varVal]),
  ]
}

const getMinAndSegAngVals = (
  referenceSegName: string,
  varVal: Expr,
  fnName: 'legAngX' | 'legAngY' = 'legAngX'
): [Expr, BinaryPart] => {
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

const getSignedLeg = (arg: Expr, legLenVal: BinaryPart) =>
  arg.type === 'Literal' && Number(arg.value) < 0
    ? createUnaryExpression(legLenVal)
    : legLenVal

const getLegAng = (arg: Expr, legAngleVal: BinaryPart) => {
  const ang = (arg.type === 'Literal' && Number(arg.value)) || 0
  const normalisedAngle = ((ang % 360) + 360) % 360 // between 0 and 360
  const truncatedTo90 = Math.floor(normalisedAngle / 90) * 90
  const binExp = createBinaryExpressionWithUnary([
    createLiteral(truncatedTo90),
    legAngleVal,
  ])
  return truncatedTo90 === 0 ? legAngleVal : binExp
}

const getAngleLengthSign = (arg: Expr, legAngleVal: BinaryPart) => {
  const ang = (arg.type === 'Literal' && Number(arg.value)) || 0
  const normalisedAngle = ((ang % 180) + 180) % 180 // between 0 and 180
  return normalisedAngle > 90 ? createUnaryExpression(legAngleVal) : legAngleVal
}

function getClosesAngleDirection(
  arg: Expr,
  refAngle: number,
  angleVal: BinaryPart
) {
  const currentAng = (arg.type === 'Literal' && Number(arg.value)) || 0
  const angDiff = Math.abs(currentAng - refAngle)
  const normalisedAngle = ((angDiff % 360) + 360) % 360 // between 0 and 180
  return normalisedAngle > 90
    ? createBinaryExpressionWithUnary([angleVal, createLiteral(180)])
    : angleVal
}

const setHorzVertDistanceCreateNode =
  (
    xOrY: 'x' | 'y',
    index = xOrY === 'x' ? 0 : 1
  ): TransformInfo['createNode'] =>
  ({ referenceSegName, tag, forceValueUsedInTransform }) => {
    return (args, referencedSegment) => {
      const valueUsedInTransform = roundOff(
        getArgLiteralVal(args?.[index].varExpression) -
          (referencedSegment?.to?.[index] || 0),
        2
      )
      let finalValue: Expr = createBinaryExpressionWithUnary([
        createSegEnd(referenceSegName, !index),
        (forceValueUsedInTransform as BinaryPart) ||
          createLiteral(valueUsedInTransform),
      ])
      if (isValueZero(forceValueUsedInTransform)) {
        finalValue = createSegEnd(referenceSegName, !index)
      }
      return createCallWrapper(
        'lineTo',
        !index
          ? [finalValue, args[1].varExpression]
          : [args[0].varExpression, finalValue],
        tag,
        valueUsedInTransform
      )
    }
  }
const setHorzVertDistanceForAngleLineCreateNode =
  (
    xOrY: 'x' | 'y',
    index = xOrY === 'x' ? 0 : 1
  ): TransformInfo['createNode'] =>
  ({ referenceSegName, tag, forceValueUsedInTransform, inputs }) => {
    return (args, referencedSegment) => {
      const valueUsedInTransform = roundOff(
        getArgLiteralVal(args?.[1].varExpression) -
          (referencedSegment?.to?.[index] || 0),
        2
      )
      const binExp = createBinaryExpressionWithUnary([
        createSegEnd(referenceSegName, !index),
        (forceValueUsedInTransform as BinaryPart) ||
          createLiteral(valueUsedInTransform),
      ])
      return createCallWrapper(
        xOrY === 'x' ? 'angledLineToX' : 'angledLineToY',
        [inputs[0].varExpression, binExp],
        tag,
        valueUsedInTransform
      )
    }
  }

const setAbsDistanceCreateNode =
  (
    xOrY: 'x' | 'y',
    isXOrYLine = false,
    index = xOrY === 'x' ? 0 : 1
  ): TransformInfo['createNode'] =>
  ({ tag, forceValueUsedInTransform }) =>
  (args) => {
    const valueUsedInTransform = roundOff(
      getArgLiteralVal(args?.[index].varExpression),
      2
    )
    const val =
      (forceValueUsedInTransform as BinaryPart) ||
      createLiteral(valueUsedInTransform)
    if (isXOrYLine) {
      return createCallWrapper(
        xOrY === 'x' ? 'xLineTo' : 'yLineTo',
        val,
        tag,
        valueUsedInTransform
      )
    }
    return createCallWrapper(
      'lineTo',
      !index ? [val, args[1].varExpression] : [args[0].varExpression, val],
      tag,
      valueUsedInTransform
    )
  }
const setAbsDistanceForAngleLineCreateNode =
  (xOrY: 'x' | 'y'): TransformInfo['createNode'] =>
  ({ tag, forceValueUsedInTransform, inputs }) => {
    return (args) => {
      const valueUsedInTransform = roundOff(
        getArgLiteralVal(args?.[1].varExpression),
        2
      )
      const val =
        (forceValueUsedInTransform as BinaryPart) ||
        createLiteral(valueUsedInTransform)
      return createCallWrapper(
        xOrY === 'x' ? 'angledLineToX' : 'angledLineToY',
        [inputs[0].varExpression, val],
        tag,
        valueUsedInTransform
      )
    }
  }

const setHorVertDistanceForXYLines =
  (xOrY: 'x' | 'y'): TransformInfo['createNode'] =>
  ({ referenceSegName, tag, forceValueUsedInTransform }) => {
    return (args, referencedSegment) => {
      const index = xOrY === 'x' ? 0 : 1
      const valueUsedInTransform = roundOff(
        getArgLiteralVal(args?.[index].varExpression) -
          (referencedSegment?.to?.[index] || 0),
        2
      )
      const makeBinExp = createBinaryExpressionWithUnary([
        createSegEnd(referenceSegName, xOrY === 'x'),
        (forceValueUsedInTransform as BinaryPart) ||
          createLiteral(valueUsedInTransform),
      ])
      return createCallWrapper(
        xOrY === 'x' ? 'xLineTo' : 'yLineTo',
        makeBinExp,
        tag,
        valueUsedInTransform
      )
    }
  }

const setHorzVertDistanceConstraintLineCreateNode =
  (isX: boolean): TransformInfo['createNode'] =>
  ({ referenceSegName, tag, inputs }) => {
    let varVal = isX ? inputs[1].varExpression : inputs[0].varExpression
    varVal = isExprBinaryPart(varVal) ? varVal : createLiteral(0)
    const varValBinExp = createBinaryExpressionWithUnary([
      createLastSeg(!isX),
      varVal,
    ])

    return (args, referencedSegment) => {
      const makeBinExp = (index: 0 | 1) => {
        const arg = getArgLiteralVal(args?.[index].varExpression)
        return createBinaryExpressionWithUnary([
          createSegEnd(referenceSegName, isX),
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

const setAngledIntersectLineForLines: TransformInfo['createNode'] =
  ({ referenceSegName, tag, forceValueUsedInTransform }) =>
  (args) => {
    const valueUsedInTransform = roundOff(
      args[1].varExpression.type === 'Literal'
        ? Number(args[1].varExpression.value)
        : 0,
      2
    )
    const angle =
      args[0].varExpression.type === 'Literal'
        ? Number(args[0].varExpression.value)
        : 0
    const varNamMap: { [key: number]: string } = {
      0: 'ZERO',
      90: 'QUARTER_TURN',
      180: 'HALF_TURN',
      270: 'THREE_QUARTER_TURN',
    }
    const angleVal = [0, 90, 180, 270].includes(angle)
      ? createIdentifier(varNamMap[angle])
      : createLiteral(angle)
    return intersectCallWrapper({
      fnName: 'angledLineThatIntersects',
      angleVal,
      offsetVal:
        forceValueUsedInTransform || createLiteral(valueUsedInTransform),
      intersectTag: createIdentifier(referenceSegName),
      tag,
      valueUsedInTransform,
    })
  }

const setAngledIntersectForAngledLines: TransformInfo['createNode'] =
  ({ referenceSegName, tag, forceValueUsedInTransform, inputs }) =>
  (args) => {
    const valueUsedInTransform = roundOff(
      args[1].varExpression.type === 'Literal'
        ? Number(args[1].varExpression.value)
        : 0,
      2
    )
    return intersectCallWrapper({
      fnName: 'angledLineThatIntersects',
      angleVal: inputs[0].varExpression,
      offsetVal:
        forceValueUsedInTransform || createLiteral(valueUsedInTransform),
      intersectTag: createIdentifier(referenceSegName),
      tag,
      valueUsedInTransform,
    })
  }

const setAngleBetweenCreateNode =
  (tranformToType: 'none' | 'xAbs' | 'yAbs'): TransformInfo['createNode'] =>
  ({ referenceSegName, tag, forceValueUsedInTransform, inputs }) => {
    return (args, referencedSegment) => {
      const refAngle = referencedSegment
        ? getAngle(referencedSegment?.from, referencedSegment?.to)
        : 0
      let valueUsedInTransform = roundOff(
        normaliseAngle(
          (args[0].varExpression.type === 'Literal'
            ? Number(args[0].varExpression.value)
            : 0) - refAngle
        )
      )
      let firstHalfValue = createSegAngle(referenceSegName) as BinaryPart
      if (Math.abs(valueUsedInTransform) > 90) {
        firstHalfValue = createBinaryExpression([
          firstHalfValue,
          '+',
          createIdentifier('HALF_TURN'),
        ])
        valueUsedInTransform = normaliseAngle(valueUsedInTransform - 180)
      }
      const binExp = createBinaryExpressionWithUnary([
        firstHalfValue,
        (forceValueUsedInTransform as BinaryPart) ||
          createLiteral(valueUsedInTransform),
      ])
      return createCallWrapper(
        tranformToType === 'none'
          ? 'angledLine'
          : tranformToType === 'xAbs'
          ? 'angledLineToX'
          : 'angledLineToY',
        tranformToType === 'none'
          ? [binExp, args[1].varExpression]
          : tranformToType === 'xAbs'
          ? [binExp, inputs[0].varExpression]
          : [binExp, inputs[1].varExpression],
        tag,
        valueUsedInTransform
      )
    }
  }

const transformMap: TransformMap = {
  line: {
    xRelative: {
      equalLength: {
        tooltip: 'line',
        createNode: ({ referenceSegName, inputs, tag }) => {
          const [minVal, legLenVal] = getMinAndSegLenVals(
            referenceSegName,
            inputs[0].varExpression
          )
          return (args) =>
            createCallWrapper(
              'line',
              [minVal, getSignedLeg(args[1].varExpression, legLenVal)],
              tag
            )
        },
      },
      horizontal: {
        tooltip: 'xLine',
        createNode:
          ({ inputs, tag }) =>
          () =>
            createCallWrapper('xLine', inputs[0].varExpression, tag),
      },
      setVertDistance: {
        tooltip: 'lineTo',
        createNode: setHorzVertDistanceConstraintLineCreateNode(false),
      },
    },
    yRelative: {
      equalLength: {
        tooltip: 'line',
        createNode: ({ referenceSegName, inputs, tag }) => {
          const [minVal, legLenVal] = getMinAndSegLenVals(
            referenceSegName,
            inputs[1].varExpression
          )
          return (args) =>
            createCallWrapper(
              'line',
              [getSignedLeg(args[0].varExpression, legLenVal), minVal],
              tag
            )
        },
      },
      vertical: {
        tooltip: 'yLine',
        createNode:
          ({ inputs, tag }) =>
          () =>
            createCallWrapper('yLine', inputs[1].varExpression, tag),
      },
      setHorzDistance: {
        tooltip: 'lineTo',
        createNode: setHorzVertDistanceConstraintLineCreateNode(true),
      },
    },
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('len'),
      },
      horizontal: {
        tooltip: 'xLine',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('xLine', args[0].varExpression, tag),
      },
      vertical: {
        tooltip: 'yLine',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper(
              'yLine',
              getInputOfType(args, 'yRelative').varExpression,
              tag
            ),
      },
      setHorzDistance: {
        tooltip: 'lineTo',
        createNode: setHorzVertDistanceCreateNode('x'),
      },
      xAbs: {
        tooltip: 'lineTo',
        createNode: setAbsDistanceCreateNode('x'),
      },
      setVertDistance: {
        tooltip: 'lineTo',
        createNode: setHorzVertDistanceCreateNode('y'),
      },
      yAbs: {
        tooltip: 'lineTo',
        createNode: setAbsDistanceCreateNode('y'),
      },
      setAngle: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('none', 'ang'),
      },
      setLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('none', 'len'),
      },
      equalAngle: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('ang'),
      },
      intersect: {
        tooltip: 'angledLineThatIntersects',
        createNode: setAngledIntersectLineForLines,
      },
      setAngleBetween: {
        tooltip: 'angledLine',
        createNode: setAngleBetweenCreateNode('none'),
      },
    },
  },
  lineTo: {
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('len'),
      },
      horizontal: {
        tooltip: 'xLineTo',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('xLineTo', args[0].varExpression, tag),
      },
      vertical: {
        tooltip: 'yLineTo',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper(
              'yLineTo',
              getInputOfType(args, 'yAbsolute').varExpression,
              tag
            ),
      },
    },
    xAbsolute: {
      equalLength: {
        tooltip: 'angledLineToX',
        createNode:
          ({ referenceSegName, inputs, tag }) =>
          (args) => {
            const angleToMatchLengthXCall = createCallExpression(
              'angleToMatchLengthX',
              [
                createIdentifier(referenceSegName),
                inputs[0].varExpression,
                createPipeSubstitution(),
              ]
            )
            return createCallWrapper(
              'angledLineToX',
              [
                getAngleLengthSign(
                  args[0].varExpression,
                  angleToMatchLengthXCall
                ),
                inputs[0].varExpression,
              ],
              tag
            )
          },
      },
      horizontal: {
        tooltip: 'xLineTo',
        createNode:
          ({ inputs, tag }) =>
          () =>
            createCallWrapper('xLineTo', inputs[0].varExpression, tag),
      },
      setAngleBetween: {
        tooltip: 'angledLineToX',
        createNode: setAngleBetweenCreateNode('xAbs'),
      },
    },
    yAbsolute: {
      equalLength: {
        tooltip: 'angledLineToY',
        createNode:
          ({ referenceSegName, inputs, tag }) =>
          (args) => {
            const angleToMatchLengthYCall = createCallExpression(
              'angleToMatchLengthY',
              [
                createIdentifier(referenceSegName),
                inputs[1].varExpression,
                createPipeSubstitution(),
              ]
            )
            return createCallWrapper(
              'angledLineToY',
              [
                getAngleLengthSign(
                  args[0].varExpression,
                  angleToMatchLengthYCall
                ),
                inputs[1].varExpression,
              ],
              tag
            )
          },
      },
      vertical: {
        tooltip: 'yLineTo',
        createNode:
          ({ inputs, tag }) =>
          () =>
            createCallWrapper('yLineTo', inputs[1].varExpression, tag),
      },
      setAngle: {
        tooltip: 'angledLineToY',
        createNode:
          ({ inputs, tag, forceValueUsedInTransform }) =>
          (args) => {
            return createCallWrapper(
              'angledLineToY',
              [
                forceValueUsedInTransform || args[0].varExpression,
                inputs[1].varExpression,
              ],
              tag,
              getArgLiteralVal(args[0].varExpression)
            )
          },
      },
      setAngleBetween: {
        tooltip: 'angledLineToY',
        createNode: setAngleBetweenCreateNode('yAbs'),
      },
    },
  },
  angledLine: {
    angle: {
      equalLength: {
        tooltip: 'angledLine',
        createNode:
          ({ referenceSegName, inputs, tag }) =>
          () =>
            createCallWrapper(
              'angledLine',
              [inputs[0].varExpression, createSegLen(referenceSegName)],
              tag
            ),
      },
      setLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('none', 'len', 'ang'),
      },
      setVertDistance: {
        tooltip: 'angledLineToY',
        createNode: setHorzVertDistanceForAngleLineCreateNode('y'),
      },
      yAbs: {
        tooltip: 'angledLineToY',
        createNode: setAbsDistanceForAngleLineCreateNode('y'),
      },
      setHorzDistance: {
        tooltip: 'angledLineToX',
        createNode: setHorzVertDistanceForAngleLineCreateNode('x'),
      },
      xAbs: {
        tooltip: 'angledLineToX',
        createNode: setAbsDistanceForAngleLineCreateNode('x'),
      },
      intersect: {
        tooltip: 'angledLineThatIntersects',
        createNode: setAngledIntersectForAngledLines,
      },
    },
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('len'),
      },
      setLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('none', 'len'),
      },
      vertical: {
        tooltip: 'yLine',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper(
              'yLine',
              getInputOfType(args, 'yRelative').varExpression,
              tag
            ),
      },
      horizontal: {
        tooltip: 'xLine',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('xLine', args[0].varExpression, tag),
      },
    },
    length: {
      vertical: {
        tooltip: 'yLine',
        createNode:
          ({ inputs, tag }) =>
          ([arg0]) => {
            const expr = inputs[1].varExpression
            if (
              !(
                arg0.varExpression.type === 'Literal' &&
                Number(arg0.varExpression.value) < 0
              )
            )
              return createCallWrapper('yLine', expr, tag)
            if (isExprBinaryPart(expr))
              return createCallWrapper(
                'yLine',
                createUnaryExpression(expr),
                tag
              )
            // TODO maybe should return error here instead
            return createCallWrapper('yLine', expr, tag)
          },
      },
      horizontal: {
        tooltip: 'xLine',
        createNode:
          ({ inputs, tag }) =>
          ([arg0]) => {
            const expr = inputs[1].varExpression
            if (
              !(
                arg0.varExpression.type === 'Literal' &&
                Number(arg0.varExpression.value) < 0
              )
            )
              return createCallWrapper('xLine', expr, tag)
            if (isExprBinaryPart(expr))
              return createCallWrapper(
                'xLine',
                createUnaryExpression(expr),
                tag
              )
            // TODO maybe should return error here instead
            return createCallWrapper('xLine', expr, tag)
          },
      },
      setAngle: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('len', 'ang', 'len'),
      },
      equalAngle: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('ang', 'len', 'len'),
      },
    },
  },
  angledLineOfXLength: {
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('len'),
      },
      horizontal: {
        tooltip: 'xLine',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('xLine', args[0].varExpression, tag),
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
        createNode: ({ referenceSegName, inputs, tag }) => {
          const [minVal, legAngle] = getMinAndSegAngVals(
            referenceSegName,
            getInputOfType(inputs, 'xRelative').varExpression
          )
          return (args) =>
            createCallWrapper(
              'angledLineOfXLength',
              [getLegAng(args[0].varExpression, legAngle), minVal],
              tag
            )
        },
      },
      horizontal: {
        tooltip: 'xLine',
        createNode:
          ({ inputs, tag }) =>
          ([arg0]) => {
            const expr = inputs[1].varExpression
            if (
              !(
                arg0.varExpression.type === 'Literal' &&
                Number(arg0.varExpression.value) < 0
              )
            )
              return createCallWrapper('xLine', expr, tag)
            if (isExprBinaryPart(expr))
              return createCallWrapper(
                'xLine',
                createUnaryExpression(expr),
                tag
              )
            // TODO maybe should return error here instead
            return createCallWrapper('xLine', expr, tag)
          },
      },
    },
  },
  angledLineOfYLength: {
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('len'),
      },
      vertical: {
        tooltip: 'yLine',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper(
              'yLine',
              getInputOfType(args, 'yRelative').varExpression,
              tag
            ),
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
        createNode: ({ referenceSegName, inputs, tag }) => {
          const [minVal, legAngle] = getMinAndSegAngVals(
            referenceSegName,
            inputs[1].varExpression,
            'legAngY'
          )
          return (args) =>
            createCallWrapper(
              'angledLineOfXLength',
              [getLegAng(args[0].varExpression, legAngle), minVal],
              tag
            )
        },
      },
      vertical: {
        tooltip: 'yLine',
        createNode:
          ({ inputs, tag }) =>
          ([arg0]) => {
            const expr = inputs[1].varExpression
            if (
              !(
                arg0.varExpression.type === 'Literal' &&
                Number(arg0.varExpression.value) < 0
              )
            )
              return createCallWrapper('yLine', expr, tag)
            if (isExprBinaryPart(expr))
              return createCallWrapper(
                'yLine',
                createUnaryExpression(expr),
                tag
              )
            // TODO maybe should return error here instead
            return createCallWrapper('yLine', expr, tag)
          },
      },
    },
  },
  angledLineToX: {
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('len'),
      },
      horizontal: {
        tooltip: 'xLineTo',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper('xLineTo', args[0].varExpression, tag),
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
          ({ referenceSegName, inputs, tag }) =>
          (args) => {
            const angleToMatchLengthXCall = createCallExpression(
              'angleToMatchLengthX',
              [
                createIdentifier(referenceSegName),
                inputs[1].varExpression,
                createPipeSubstitution(),
              ]
            )
            return createCallWrapper(
              'angledLineToX',
              [
                getAngleLengthSign(
                  args[0].varExpression,
                  angleToMatchLengthXCall
                ),
                inputs[1].varExpression,
              ],
              tag
            )
          },
      },
      horizontal: {
        tooltip: 'xLineTo',
        createNode:
          ({ inputs, tag }) =>
          ([arg0]) =>
            createCallWrapper('xLineTo', inputs[1].varExpression, tag),
      },
    },
  },
  angledLineToY: {
    free: {
      equalLength: {
        tooltip: 'angledLine',
        createNode: basicAngledLineCreateNode('len'),
      },
      vertical: {
        tooltip: 'yLineTo',
        createNode:
          ({ tag }) =>
          (args) =>
            createCallWrapper(
              'yLineTo',
              getInputOfType(args, 'yAbsolute').varExpression,
              tag
            ),
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
          ({ referenceSegName, inputs, tag }) =>
          (args) => {
            const angleToMatchLengthXCall = createCallExpression(
              'angleToMatchLengthY',
              [
                createIdentifier(referenceSegName),
                inputs[1].varExpression,
                createPipeSubstitution(),
              ]
            )
            return createCallWrapper(
              'angledLineToY',
              [
                getAngleLengthSign(
                  args[0].varExpression,
                  angleToMatchLengthXCall
                ),
                inputs[1].varExpression,
              ],
              tag
            )
          },
      },
      vertical: {
        tooltip: 'yLineTo',
        createNode:
          ({ inputs, tag }) =>
          () =>
            createCallWrapper('yLineTo', inputs[1].varExpression, tag),
      },
    },
  },
  xLine: {
    free: {
      equalLength: {
        tooltip: 'xLine',
        createNode:
          ({ referenceSegName, tag }) =>
          (arg) => {
            const argVal = getArgLiteralVal(arg[0].varExpression)
            const segLen = createSegLen(referenceSegName) // as BinaryPart
            if (argVal > 0)
              return createCallWrapper('xLine', segLen, tag, argVal)
            if (isExprBinaryPart(segLen))
              return createCallWrapper(
                'xLine',
                createUnaryExpression(segLen),
                tag,
                argVal
              )
            // should probably return error here instead
            return createCallWrapper('xLine', segLen, tag, argVal)
          },
      },
      setHorzDistance: {
        tooltip: 'xLineTo',
        createNode: setHorVertDistanceForXYLines('x'),
      },
      setLength: {
        tooltip: 'xLine',
        createNode: xyLineSetLength('xLine'),
      },
      intersect: {
        tooltip: 'angledLineThatIntersects',
        createNode: setAngledIntersectLineForLines,
      },
      xAbs: {
        tooltip: 'xLineTo',
        createNode: setAbsDistanceCreateNode('x', true),
      },
    },
  },
  yLine: {
    free: {
      equalLength: {
        tooltip: 'yLine',
        createNode:
          ({ referenceSegName, tag }) =>
          (arg) => {
            const argVal = getArgLiteralVal(arg[0].varExpression)
            let segLen = createSegLen(referenceSegName) as BinaryPart
            if (argVal < 0) segLen = createUnaryExpression(segLen)
            return createCallWrapper('yLine', segLen, tag, argVal)
          },
      },
      setLength: {
        tooltip: 'yLine',
        createNode: xyLineSetLength('yLine'),
      },
      setVertDistance: {
        tooltip: 'yLineTo',
        createNode: setHorVertDistanceForXYLines('y'),
      },
      intersect: {
        tooltip: 'angledLineThatIntersects',
        createNode: setAngledIntersectLineForLines,
      },
      yAbs: {
        tooltip: 'yLineTo',
        createNode: setAbsDistanceCreateNode('y', true),
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
      setLength: {
        tooltip: 'xLine',
        createNode: xyLineSetLength('xLine'),
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
      setLength: {
        tooltip: 'yLine',
        createNode: xyLineSetLength('yLine'),
      },
    },
  },
}

export function getRemoveConstraintsTransform(
  sketchFnExp: CallExpression,
  constraintType: ConstraintType
): TransformInfo | false {
  let name = sketchFnExp.callee.name as ToolTip
  if (!toolTips.includes(name)) {
    return false
  }
  const xyLineMap: {
    [key in ToolTip]?: ToolTip
  } = {
    xLine: 'line',
    yLine: 'line',
    xLineTo: 'lineTo',
    yLineTo: 'lineTo',
  }

  const _name = xyLineMap[name]
  if (_name) {
    name = _name
  }

  const transformInfo: TransformInfo = {
    tooltip: 'line',
    // tooltip: name,
    createNode:
      ({ tag, referenceSegName }) =>
      (args) => {
        return createCallWrapper(
          'line',
          [args[0].varExpression, args[1].varExpression],
          tag
        )
        // The following commented changes values to hardcode, but keeps the line type the same, maybe that's useful?

        //   if (name === 'angledLineThatIntersects') {
        //     return intersectCallWrapper({
        //       fnName: name,
        //       angleVal: args[0].varExpression,
        //       offsetVal: args[1].varExpression,
        //       intersectTag: createIdentifier(referenceSegName),
        //       tag,
        //     })
        //   }
        //   return createCallWrapper(name, args, tag)
      },
  }

  // check if the function is locked down and so can't be transformed
  const firstArg = getFirstArg(sketchFnExp)
  if (err(firstArg)) {
    console.error(firstArg)
    return false
  }

  if (isNotLiteralArrayOrStatic(firstArg.val)) {
    return transformInfo
  }

  // check if the function has no constraints
  const isTwoValFree =
    Array.isArray(firstArg.val) && isLiteralArrayOrStatic(firstArg.val)
  if (isTwoValFree) {
    return false
  }
  const isOneValFree =
    !Array.isArray(firstArg.val) && isLiteralArrayOrStatic(firstArg.val)
  if (isOneValFree) {
    return transformInfo
  }

  // check what constraints the function has
  const lineInputType = getConstraintType(firstArg.val, name)
  if (lineInputType) {
    return transformInfo
  }

  return false
}

export function removeSingleConstraint({
  pathToCallExp,
  inputDetails,
  ast,
}: {
  pathToCallExp: PathToNode
  inputDetails: SimplifiedArgDetails
  ast: Program
}): TransformInfo | false {
  const callExp = getNodeFromPath<CallExpression>(
    ast,
    pathToCallExp,
    'CallExpression'
  )
  if (err(callExp)) {
    console.error(callExp)
    return false
  }
  if (callExp.node.type !== 'CallExpression') {
    console.error(new Error('Invalid node type'))
    return false
  }

  const transform: TransformInfo = {
    tooltip: callExp.node.callee.name as any,
    createNode:
      ({ tag, inputs }) =>
      (rawValues) => {
        // inputs is the current values for each of the inputs
        // rawValues is the rav 'literal' values equivalent to the inputs
        // inputDetails is the one variable we're removing the constraint from
        // So we should update the call expression to use the inputs, except for
        // the inputDetails, input where we should use the rawValue(s)

        if (inputDetails.type === 'arrayItem') {
          const values = inputs.map(({ varDetails: varValue }) => {
            if (
              !(
                (varValue.type === 'arrayItem' ||
                  varValue.type === 'arrayOrObjItem') &&
                varValue.index === inputDetails.index
              )
            )
              return varValue.expr
            const literal = rawValues.find(
              (rawValue) =>
                (rawValue.varDetails.type === 'arrayItem' ||
                  rawValue.varDetails.type === 'arrayOrObjItem') &&
                rawValue.varDetails.index === inputDetails.index
            )?.varDetails?.expr
            return (
              (varValue.index === inputDetails.index && literal) ||
              varValue.expr
            )
          })
          return createStdlibCallExpression(
            callExp.node.callee.name as any,
            createArrayExpression(values),
            tag
          )
        }
        if (
          inputDetails.type === 'arrayInObject' ||
          inputDetails.type === 'objectProperty'
        ) {
          const arrayDetailsNameBetterLater: {
            [key: string]: Parameters<typeof createArrayExpression>[0]
          } = {}
          const otherThing: Parameters<typeof createObjectExpression>[0] = {}
          inputs.forEach(({ varDetails: varValue, varExpression }) => {
            if (
              varValue.type !== 'objectProperty' &&
              varValue.type !== 'arrayOrObjItem' &&
              varValue.type !== 'arrayInObject'
            )
              return
            const rawLiteralArrayInObject = rawValues.find(
              (rawValue) =>
                rawValue.varDetails.type === 'arrayInObject' &&
                rawValue.varDetails.key === inputDetails.key &&
                rawValue.varDetails.index ===
                  (varValue.type === 'arrayInObject' ? varValue.index : -1)
            )
            const rawLiteralObjProp = rawValues.find(
              (rawValue) =>
                (rawValue.varDetails.type === 'objectProperty' ||
                  rawValue.varDetails.type === 'arrayOrObjItem' ||
                  rawValue.varDetails.type === 'arrayInObject') &&
                rawValue.varDetails.key === inputDetails.key
            )
            if (
              inputDetails.type === 'arrayInObject' &&
              rawLiteralArrayInObject?.varDetails.type === 'arrayInObject' &&
              rawLiteralArrayInObject?.varDetails.index ===
                inputDetails.index &&
              rawLiteralArrayInObject?.varDetails.key === inputDetails.key
            ) {
              if (!arrayDetailsNameBetterLater[varValue.key])
                arrayDetailsNameBetterLater[varValue.key] = []
              arrayDetailsNameBetterLater[inputDetails.key][
                inputDetails.index
              ] = rawLiteralArrayInObject.varDetails.expr
            } else if (
              inputDetails.type === 'objectProperty' &&
              (rawLiteralObjProp?.varDetails.type === 'objectProperty' ||
                rawLiteralObjProp?.varDetails.type === 'arrayOrObjItem') &&
              rawLiteralObjProp?.varDetails.key === inputDetails.key &&
              varValue.key === inputDetails.key
            ) {
              otherThing[inputDetails.key] = rawLiteralObjProp.varDetails.expr
            } else if (varValue.type === 'arrayInObject') {
              if (!arrayDetailsNameBetterLater[varValue.key])
                arrayDetailsNameBetterLater[varValue.key] = []
              arrayDetailsNameBetterLater[varValue.key][varValue.index] =
                varExpression
            } else if (varValue.type === 'objectProperty') {
              otherThing[varValue.key] = varExpression
            }
          })
          const createObjParam: Parameters<typeof createObjectExpression>[0] =
            {}
          Object.entries(arrayDetailsNameBetterLater).forEach(
            ([key, value]) => {
              createObjParam[key] = createArrayExpression(value)
            }
          )
          const objExp = createObjectExpression({
            ...createObjParam,
            ...otherThing,
          })
          return createStdlibCallExpression(
            callExp.node.callee.name as any,
            objExp,
            tag
          )
        }

        return createCallWrapper(
          callExp.node.callee.name as any,
          rawValues[0].varDetails.expr,
          tag
        )
      },
  }
  return transform
}

function getTransformMapPath(
  sketchFnExp: CallExpression,
  constraintType: ConstraintType
):
  | {
      toolTip: ToolTip
      lineInputType: LineInputsType | 'free'
      constraintType: ConstraintType
    }
  | false {
  const name = sketchFnExp.callee.name as ToolTip
  if (!toolTips.includes(name)) {
    return false
  }

  // check if the function is locked down and so can't be transformed
  const firstArg = getFirstArg(sketchFnExp)
  if (err(firstArg)) {
    console.error(firstArg)
    return false
  }

  if (isNotLiteralArrayOrStatic(firstArg.val)) {
    return false
  }

  // check if the function has no constraints
  if (isLiteralArrayOrStatic(firstArg.val)) {
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
  val: Expr | [Expr, Expr] | [Expr, Expr, Expr],
  fnName: ToolTip
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
    const isFirstArgLockedDown = isNotLiteralArrayOrStatic(val[0])
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
  selectionRanges: Selections,
  ast: Program,
  constraintType: ConstraintType
): TransformInfo[] {
  const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
    getNodePathFromSourceRange(ast, range)
  )
  const nodes = paths.map((pathToNode) =>
    getNodeFromPath<Expr>(ast, pathToNode, 'CallExpression')
  )

  try {
    const theTransforms = nodes.map((nodeMeta) => {
      if (err(nodeMeta)) {
        console.error(nodeMeta)
        return false
      }

      const node = nodeMeta.node
      if (node?.type === 'CallExpression')
        return getTransformInfo(node, constraintType)

      return false
    }) as TransformInfo[]
    return theTransforms
  } catch (error) {
    console.log('error', error)
    return []
  }
}

export function getRemoveConstraintsTransforms(
  selectionRanges: Selections,
  ast: Program,
  constraintType: ConstraintType
): TransformInfo[] | Error {
  // return ()
  const paths = selectionRanges.codeBasedSelections.map((selectionRange) =>
    getNodePathFromSourceRange(ast, selectionRange.range)
  )
  const nodes = paths.map((pathToNode) =>
    getNodeFromPath<Expr>(ast, pathToNode)
  )

  const theTransforms = nodes.map((nodeMeta) => {
    // Typescript is not smart enough to know node will never be Error
    // here, but we'll place a condition anyway
    if (err(nodeMeta)) {
      console.error(nodeMeta)
      return false
    }

    const node = nodeMeta.node
    if (node?.type === 'CallExpression')
      return getRemoveConstraintsTransform(node, constraintType)

    return false
  }) as TransformInfo[]
  return theTransforms
}

export type PathToNodeMap = { [key: number]: PathToNode }

export function transformSecondarySketchLinesTagFirst({
  ast,
  selectionRanges,
  transformInfos,
  programMemory,
  forceSegName,
  forceValueUsedInTransform,
}: {
  ast: Program
  selectionRanges: Selections
  transformInfos: TransformInfo[]
  programMemory: ProgramMemory
  forceSegName?: string
  forceValueUsedInTransform?: Expr
}):
  | {
      modifiedAst: Program
      valueUsedInTransform?: number
      pathToNodeMap: PathToNodeMap
      tagInfo: {
        tag: string
        isTagExisting: boolean
      }
    }
  | Error {
  // let node = structuredClone(ast)
  const primarySelection = selectionRanges.codeBasedSelections[0].range

  const _tag = giveSketchFnCallTag(ast, primarySelection, forceSegName)
  if (err(_tag)) return _tag
  const { modifiedAst, tag, isTagExisting, pathToNode } = _tag

  const result = transformAstSketchLines({
    ast: modifiedAst,
    selectionRanges: {
      ...selectionRanges,
      codeBasedSelections: selectionRanges.codeBasedSelections.slice(1),
    },
    referencedSegmentRange: primarySelection,
    transformInfos,
    programMemory,
    referenceSegName: tag,
    forceValueUsedInTransform,
  })
  if (err(result)) return result

  const updatedPathToNodeMap = incrementPathToNodeMap(result.pathToNodeMap)
  updatedPathToNodeMap[0] = pathToNode

  return {
    ...result,
    pathToNodeMap: updatedPathToNodeMap,
    tagInfo: {
      tag,
      isTagExisting,
    },
  }
}

function incrementPathToNodeMap(
  pathToNodeMap: PathToNodeMap,
  increment = 1
): PathToNodeMap {
  const newMap: PathToNodeMap = {}
  Object.entries(pathToNodeMap).forEach(([key, path]) => {
    newMap[Number(key) + increment] = path
  })
  return newMap
}

export function transformAstSketchLines({
  ast,
  selectionRanges,
  transformInfos,
  programMemory,
  referenceSegName,
  forceValueUsedInTransform,
  referencedSegmentRange,
}: {
  ast: Program
  selectionRanges: Selections | PathToNode[]
  transformInfos: TransformInfo[]
  programMemory: ProgramMemory
  referenceSegName: string
  forceValueUsedInTransform?: Expr
  referencedSegmentRange?: Selection['range']
}):
  | {
      modifiedAst: Program
      valueUsedInTransform?: number
      pathToNodeMap: PathToNodeMap
    }
  | Error {
  // deep clone since we are mutating in a loop, of which any could fail
  let node = structuredClone(ast)
  let _valueUsedInTransform // TODO should this be an array?
  const pathToNodeMap: PathToNodeMap = {}

  const processSelection = (_pathToNode: PathToNode, index: number) => {
    const callBack = transformInfos?.[index].createNode
    const transformTo = transformInfos?.[index].tooltip

    if (!callBack || !transformTo) return new Error('no callback helper')

    const getNode = getNodeFromPathCurry(node, _pathToNode)

    const callExp = getNode<CallExpression>('CallExpression')
    if (err(callExp)) return callExp
    const varDec = getNode<VariableDeclarator>('VariableDeclarator')
    if (err(varDec)) return varDec

    const callBackTag = callExp.node.arguments[2]
    const _referencedSegmentNameVal =
      callExp.node.arguments[0]?.type === 'ObjectExpression' &&
      callExp.node.arguments[0].properties?.find(
        (prop) => prop.key.name === 'intersectTag'
      )?.value
    const _referencedSegmentName =
      referenceSegName ||
      (_referencedSegmentNameVal &&
        _referencedSegmentNameVal.type === 'Identifier' &&
        String(_referencedSegmentNameVal.name)) ||
      ''
    const inputs: SegmentInput[] = []

    getConstraintInfo(callExp.node, '', _pathToNode).forEach((a) => {
      if (
        a.type === 'tangentialWithPrevious' ||
        a.type === 'horizontal' ||
        a.type === 'vertical'
      )
        return

      const nodeMeta = getNodeFromPath<Expr>(ast, a.pathToNode)
      if (err(nodeMeta)) return

      if (a?.argPosition?.type === 'arrayItem') {
        inputs.push({
          varDetails: {
            type: 'arrayItem',
            index: a.argPosition.index,
            expr: nodeMeta.node,
            argType: a.type,
          },
          varExpression: nodeMeta.node,
        })
      } else if (a?.argPosition?.type === 'objectProperty') {
        inputs.push({
          varDetails: {
            type: 'objectProperty',
            key: a.argPosition.key,
            expr: nodeMeta.node,
            argType: a.type,
          },
          varExpression: nodeMeta.node,
        })
      } else if (a?.argPosition?.type === 'singleValue') {
        inputs.push({
          varDetails: {
            type: 'singleValue',
            argType: a.type,
            expr: nodeMeta.node,
          },
          varExpression: nodeMeta.node,
        })
      } else if (a?.argPosition?.type === 'arrayInObject') {
        inputs.push({
          varDetails: {
            type: 'arrayInObject',
            key: a.argPosition.key,
            index: a.argPosition.index,
            expr: nodeMeta.node,
            argType: a.type,
          },
          varExpression: nodeMeta.node,
        })
      }
    })

    const varName = varDec.node.id.name
    let kclVal = programMemory.get(varName)
    let sketchGroup
    if (kclVal?.type === 'ExtrudeGroup') {
      sketchGroup = kclVal.sketchGroup
    } else {
      sketchGroup = sketchGroupFromKclValue(kclVal, varName)
      if (err(sketchGroup)) {
        return
      }
    }
    const segMeta = getSketchSegmentFromPathToNode(
      sketchGroup,
      ast,
      _pathToNode
    )
    if (err(segMeta)) return segMeta

    const seg = segMeta.segment
    let referencedSegment
    if (referencedSegmentRange) {
      const _segment = getSketchSegmentFromSourceRange(
        sketchGroup,
        referencedSegmentRange
      )
      if (err(_segment)) return _segment
      referencedSegment = _segment.segment
    } else {
      referencedSegment = sketchGroup.value.find(
        (path) => path.tag?.value === _referencedSegmentName
      )
    }
    const { to, from } = seg
    const replacedSketchLine = replaceSketchLine({
      node: node,
      programMemory,
      pathToNode: _pathToNode,
      referencedSegment,
      fnName: transformTo || (callExp.node.callee.name as ToolTip),
      segmentInput:
        seg.type === 'Circle'
          ? {
              type: 'arc-segment',
              center: seg.center,
              radius: seg.radius,
              from,
            }
          : {
              type: 'straight-segment',
              to,
              from,
            },
      createCallback: callBack({
        referenceSegName: _referencedSegmentName,
        inputs,
        tag: callBackTag,
        forceValueUsedInTransform,
      }),
    })
    if (err(replacedSketchLine)) return replacedSketchLine

    const { modifiedAst, valueUsedInTransform, pathToNode } = replacedSketchLine
    node = modifiedAst
    pathToNodeMap[index] = pathToNode
    if (typeof valueUsedInTransform === 'number') {
      _valueUsedInTransform = valueUsedInTransform
    }
  }

  if ('codeBasedSelections' in selectionRanges) {
    // If the processing of any of the selections failed, return the first error
    const maybeProcessErrors = selectionRanges.codeBasedSelections
      .map(({ range }, index) =>
        processSelection(getNodePathFromSourceRange(node, range), index)
      )
      .filter(err)

    if (maybeProcessErrors.length) return maybeProcessErrors[0]
  } else {
    const maybeProcessErrors = selectionRanges.map(processSelection).filter(err)
    if (maybeProcessErrors.length) return maybeProcessErrors[0]
  }

  return {
    modifiedAst: node,
    valueUsedInTransform: _valueUsedInTransform,
    pathToNodeMap,
  }
}

function createSegLen(referenceSegName: string): Expr {
  return createCallExpression('segLen', [createIdentifier(referenceSegName)])
}

function createSegAngle(referenceSegName: string): Expr {
  return createCallExpression('segAng', [createIdentifier(referenceSegName)])
}

function createSegEnd(referenceSegName: string, isX: boolean): CallExpression {
  return createCallExpression(isX ? 'segEndX' : 'segEndY', [
    createIdentifier(referenceSegName),
  ])
}

function createLastSeg(isX: boolean): CallExpression {
  return createCallExpression(isX ? 'lastSegX' : 'lastSegY', [
    createPipeSubstitution(),
  ])
}

function getArgLiteralVal(arg: Expr): number {
  return arg?.type === 'Literal' ? Number(arg.value) : 0
}

export type ConstraintLevel = 'free' | 'partial' | 'full'

export function getConstraintLevelFromSourceRange(
  cursorRange: Selection['range'],
  ast: Program | Error
): Error | { range: [number, number]; level: ConstraintLevel } {
  if (err(ast)) return ast
  const nodeMeta = getNodeFromPath<CallExpression>(
    ast,
    getNodePathFromSourceRange(ast, cursorRange),
    'CallExpression'
  )
  if (err(nodeMeta)) return nodeMeta

  const { node: sketchFnExp } = nodeMeta
  const name = sketchFnExp?.callee?.name as ToolTip
  const range: [number, number] = [sketchFnExp.start, sketchFnExp.end]
  if (!toolTips.includes(name)) return { level: 'free', range: range }

  const firstArg = getFirstArg(sketchFnExp)
  if (err(firstArg)) return firstArg

  // check if the function is fully constrained
  if (isNotLiteralArrayOrStatic(firstArg.val)) {
    return { level: 'full', range: range }
  }

  // check if the function has no constraints
  const isTwoValFree =
    Array.isArray(firstArg.val) && isLiteralArrayOrStatic(firstArg.val)
  const isOneValFree =
    !Array.isArray(firstArg.val) && isLiteralArrayOrStatic(firstArg.val)

  if (isTwoValFree) return { level: 'free', range: range }
  if (isOneValFree) return { level: 'partial', range: range }

  return { level: 'partial', range: range }
}

export function isLiteralArrayOrStatic(
  val: Expr | [Expr, Expr] | [Expr, Expr, Expr] | undefined
): boolean {
  if (!val) return false

  if (Array.isArray(val)) {
    const a = val[0]
    const b = val[1]
    return isLiteralArrayOrStatic(a) && isLiteralArrayOrStatic(b)
  }
  return (
    val.type === 'Literal' ||
    (val.type === 'UnaryExpression' && val.argument.type === 'Literal')
  )
}

export function isNotLiteralArrayOrStatic(
  val: Expr | [Expr, Expr] | [Expr, Expr, Expr]
): boolean {
  if (Array.isArray(val)) {
    const a = val[0]
    const b = val[1]
    return isNotLiteralArrayOrStatic(a) && isNotLiteralArrayOrStatic(b)
  }
  return (
    (val.type !== 'Literal' && val.type !== 'UnaryExpression') ||
    (val.type === 'UnaryExpression' && val.argument.type !== 'Literal')
  )
}

function isExprBinaryPart(expr: Expr): expr is BinaryPart {
  if (
    expr.type === 'Literal' ||
    expr.type === 'Identifier' ||
    expr.type === 'BinaryExpression' ||
    expr.type === 'CallExpression' ||
    expr.type === 'UnaryExpression' ||
    expr.type === 'MemberExpression'
  )
    return true
  return false
}

function getInputOfType(
  a: SegmentInput[],
  b: LineInputsType | 'radius'
): SegmentInput {
  return a.find(({ varDetails }) => varDetails.argType === b) || a[0]
}
