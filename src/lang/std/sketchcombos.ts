import {
  CreatedSketchExprResult,
  CreateStdLibSketchCallExpr,
  InputArg,
  InputArgs,
  SimplifiedArgDetails,
  TransformInfo,
} from './stdTypes'
import { ToolTip, toolTips } from 'lang/langHelpers'
import { Selections } from 'lib/selections'
import { cleanErrs, err } from 'lib/trap'
import {
  CallExpression,
  Program,
  Expr,
  BinaryPart,
  VariableDeclarator,
  PathToNode,
  ProgramMemory,
  sketchFromKclValue,
  Literal,
  SourceRange,
  LiteralValue,
} from '../wasm'
import { getNodeFromPath, getNodeFromPathCurry } from 'lang/queryAst'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
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
import { Node } from 'wasm-lib/kcl/bindings/Node'

export type LineInputsType =
  | 'xAbsolute'
  | 'yAbsolute'
  | 'xRelative'
  | 'yRelative'
  | 'angle'
  | 'length'
  | 'intersectionOffset'
  | 'intersectionTag'
  | 'radius'

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

const REF_NUM_ERR = new Error('Referenced segment does not have a to value')

function asNum(val: LiteralValue): number | Error {
  if (typeof val === 'object') return val.value
  return REF_NUM_ERR
}

function forceNum(arg: Literal): number {
  if (typeof arg.value === 'boolean' || typeof arg.value === 'string') {
    return Number(arg.value)
  } else {
    return arg.value.value
  }
}

function isUndef(val: any): val is undefined {
  return typeof val === 'undefined'
}

function isValueZero(val?: Expr): boolean {
  return (
    (val?.type === 'Literal' && forceNum(val) === 0) ||
    (val?.type === 'UnaryExpression' &&
      val.operator === '-' &&
      val.argument.type === 'Literal' &&
      Number(val.argument.value) === 0)
  )
}

function createCallWrapper(
  tooltip: ToolTip,
  val: [Expr, Expr] | Expr,
  tag?: Expr,
  valueUsedInTransform?: number
): CreatedSketchExprResult {
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
): CreatedSketchExprResult {
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
}): CreatedSketchExprResult {
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

type TransformMap = {
  [key in ToolTip]?: {
    [key in LineInputsType | 'free']?: {
      [key in ConstraintType]?: TransformInfo
    }
  }
}

const xyLineSetLength =
  (xOrY: 'xLine' | 'yLine', referenceSeg = false): CreateStdLibSketchCallExpr =>
  ({ referenceSegName, tag, forceValueUsedInTransform, rawArgs: args }) => {
    const segRef = createSegLen(referenceSegName)
    const lineVal = forceValueUsedInTransform
      ? forceValueUsedInTransform
      : referenceSeg
      ? segRef
      : args[0].expr
    const literalARg = asNum(args[0].expr.value)
    if (err(literalARg)) return literalARg
    return createCallWrapper(xOrY, lineVal, tag, literalARg)
  }

type AngLenNone = 'ang' | 'len' | 'none'
const basicAngledLineCreateNode =
  (
    referenceSeg: AngLenNone = 'none',
    valToForce: AngLenNone = 'none',
    varValToUse: AngLenNone = 'none'
  ): CreateStdLibSketchCallExpr =>
  ({
    referenceSegName,
    tag,
    forceValueUsedInTransform,
    inputs,
    rawArgs: args,
    referencedSegment: path,
  }) => {
    const refAng = path ? getAngle(path?.from, path?.to) : 0
    const argValue = asNum(args[0].expr.value)
    if (err(argValue)) return argValue
    const nonForcedAng =
      varValToUse === 'ang'
        ? inputs[0].expr
        : referenceSeg === 'ang'
        ? getClosesAngleDirection(
            argValue,
            refAng,
            createSegAngle(referenceSegName)
          )
        : args[0].expr
    const nonForcedLen =
      varValToUse === 'len'
        ? inputs[1].expr
        : referenceSeg === 'len'
        ? createSegLen(referenceSegName)
        : args[1].expr
    const shouldForceAng = valToForce === 'ang' && forceValueUsedInTransform
    const shouldForceLen = valToForce === 'len' && forceValueUsedInTransform
    const literalArg = asNum(
      valToForce === 'ang' ? args[0].expr.value : args[1].expr.value
    )
    if (err(literalArg)) return literalArg
    return createCallWrapper(
      'angledLine',
      [
        shouldForceAng ? forceValueUsedInTransform : nonForcedAng,
        shouldForceLen ? forceValueUsedInTransform : nonForcedLen,
      ],
      tag,
      literalArg
    )
  }
const angledLineAngleCreateNode: CreateStdLibSketchCallExpr = ({
  referenceSegName,
  inputs,
  tag,
}) =>
  createCallWrapper(
    'angledLine',
    [inputs[0].expr, createSegLen(referenceSegName)],
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

const getSignedLeg = (arg: Literal, legLenVal: BinaryPart) =>
  forceNum(arg) < 0 ? createUnaryExpression(legLenVal) : legLenVal

const getLegAng = (ang: number, legAngleVal: BinaryPart) => {
  const normalisedAngle = ((ang % 360) + 360) % 360 // between 0 and 360
  const truncatedTo90 = Math.floor(normalisedAngle / 90) * 90
  const binExp = createBinaryExpressionWithUnary([
    createLiteral(truncatedTo90),
    legAngleVal,
  ])
  return truncatedTo90 === 0 ? legAngleVal : binExp
}

const getAngleLengthSign = (ang: number, legAngleVal: BinaryPart) => {
  const normalisedAngle = ((ang % 180) + 180) % 180 // between 0 and 180
  return normalisedAngle > 90 ? createUnaryExpression(legAngleVal) : legAngleVal
}

function getClosesAngleDirection(
  currentAng: number,
  refAngle: number,
  angleVal: BinaryPart
) {
  const angDiff = Math.abs(currentAng - refAngle)
  const normalisedAngle = ((angDiff % 360) + 360) % 360 // between 0 and 180
  return normalisedAngle > 90
    ? createBinaryExpressionWithUnary([angleVal, createLiteral(180)])
    : angleVal
}

const setHorzVertDistanceCreateNode =
  (xOrY: 'x' | 'y', index = xOrY === 'x' ? 0 : 1): CreateStdLibSketchCallExpr =>
  ({
    referenceSegName,
    tag,
    forceValueUsedInTransform,
    rawArgs: args,
    referencedSegment,
  }) => {
    const refNum = referencedSegment?.to?.[index]
    const literalArg = asNum(args?.[index].expr.value)
    if (isUndef(refNum) || err(literalArg)) return REF_NUM_ERR

    const valueUsedInTransform = roundOff(literalArg - refNum, 2)
    let finalValue: Node<Expr> = createBinaryExpressionWithUnary([
      createSegEnd(referenceSegName, !index),
      forceValueUsedInTransform || createLiteral(valueUsedInTransform),
    ])
    if (isValueZero(forceValueUsedInTransform)) {
      finalValue = createSegEnd(referenceSegName, !index)
    }
    return createCallWrapper(
      'lineTo',
      !index ? [finalValue, args[1].expr] : [args[0].expr, finalValue],
      tag,
      valueUsedInTransform
    )
  }
const setHorzVertDistanceForAngleLineCreateNode =
  (xOrY: 'x' | 'y', index = xOrY === 'x' ? 0 : 1): CreateStdLibSketchCallExpr =>
  ({
    referenceSegName,
    tag,
    forceValueUsedInTransform,
    inputs,
    rawArgs: args,
    referencedSegment,
  }) => {
    const refNum = referencedSegment?.to?.[index]
    const literalArg = asNum(args?.[1].expr.value)
    if (isUndef(refNum) || err(literalArg)) return REF_NUM_ERR
    const valueUsedInTransform = roundOff(literalArg - refNum, 2)
    const binExp = createBinaryExpressionWithUnary([
      createSegEnd(referenceSegName, !index),
      forceValueUsedInTransform || createLiteral(valueUsedInTransform),
    ])
    return createCallWrapper(
      xOrY === 'x' ? 'angledLineToX' : 'angledLineToY',
      [inputs[0].expr, binExp],
      tag,
      valueUsedInTransform
    )
  }

const setAbsDistanceCreateNode =
  (
    xOrY: 'x' | 'y',
    isXOrYLine = false,
    index = xOrY === 'x' ? 0 : 1
  ): CreateStdLibSketchCallExpr =>
  ({ tag, forceValueUsedInTransform, rawArgs: args }) => {
    const literalArg = asNum(args?.[index].expr.value)
    if (err(literalArg)) return literalArg
    const valueUsedInTransform = roundOff(literalArg, 2)
    const val = forceValueUsedInTransform || createLiteral(valueUsedInTransform)
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
      !index ? [val, args[1].expr] : [args[0].expr, val],
      tag,
      valueUsedInTransform
    )
  }
const setAbsDistanceForAngleLineCreateNode =
  (xOrY: 'x' | 'y'): CreateStdLibSketchCallExpr =>
  ({ tag, forceValueUsedInTransform, inputs, rawArgs: args }) => {
    const literalArg = asNum(args?.[1].expr.value)
    if (err(literalArg)) return literalArg
    const valueUsedInTransform = roundOff(literalArg, 2)
    const val = forceValueUsedInTransform || createLiteral(valueUsedInTransform)
    return createCallWrapper(
      xOrY === 'x' ? 'angledLineToX' : 'angledLineToY',
      [inputs[0].expr, val],
      tag,
      valueUsedInTransform
    )
  }

const setHorVertDistanceForXYLines =
  (xOrY: 'x' | 'y'): CreateStdLibSketchCallExpr =>
  ({
    referenceSegName,
    tag,
    forceValueUsedInTransform,
    rawArgs: args,
    referencedSegment,
  }) => {
    const index = xOrY === 'x' ? 0 : 1
    const refNum = referencedSegment?.to?.[index]
    const literalArg = asNum(args?.[index].expr.value)
    if (isUndef(refNum) || err(literalArg)) return REF_NUM_ERR
    const valueUsedInTransform = roundOff(literalArg - refNum, 2)
    const makeBinExp = createBinaryExpressionWithUnary([
      createSegEnd(referenceSegName, xOrY === 'x'),
      forceValueUsedInTransform || createLiteral(valueUsedInTransform),
    ])
    return createCallWrapper(
      xOrY === 'x' ? 'xLineTo' : 'yLineTo',
      makeBinExp,
      tag,
      valueUsedInTransform
    )
  }

const setHorzVertDistanceConstraintLineCreateNode =
  (isX: boolean): CreateStdLibSketchCallExpr =>
  ({ referenceSegName, tag, inputs, rawArgs: args, referencedSegment }) => {
    let varVal = isX ? inputs[1].expr : inputs[0].expr
    varVal = isExprBinaryPart(varVal) ? varVal : createLiteral(0)
    const varValBinExp = createBinaryExpressionWithUnary([
      createLastSeg(!isX),
      varVal,
    ])

    const makeBinExp = (index: 0 | 1) => {
      const arg = asNum(args?.[index].expr.value)
      const refNum = referencedSegment?.to?.[index]
      if (err(arg) || isUndef(refNum)) return REF_NUM_ERR
      return createBinaryExpressionWithUnary([
        createSegEnd(referenceSegName, isX),
        createLiteral(roundOff(arg - refNum, 2)),
      ])
    }
    const binExpr = isX ? makeBinExp(0) : makeBinExp(1)
    if (err(binExpr)) return new Error('Invalid value for distance')
    return createCallWrapper(
      'lineTo',
      isX ? [binExpr, varValBinExp] : [varValBinExp, binExpr],
      tag
    )
  }

const setAngledIntersectLineForLines: CreateStdLibSketchCallExpr = ({
  referenceSegName,
  tag,
  forceValueUsedInTransform,
  rawArgs: args,
}) => {
  const val = asNum(args[1].expr.value),
    angle = asNum(args[0].expr.value)
  if (err(val) || err(angle)) return REF_NUM_ERR
  const valueUsedInTransform = roundOff(val, 2)
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
    offsetVal: forceValueUsedInTransform || createLiteral(valueUsedInTransform),
    intersectTag: createIdentifier(referenceSegName),
    tag,
    valueUsedInTransform,
  })
}

const setAngledIntersectForAngledLines: CreateStdLibSketchCallExpr = ({
  referenceSegName,
  tag,
  forceValueUsedInTransform,
  inputs,
  rawArgs: args,
}) => {
  const val = asNum(args[1].expr.value)
  if (err(val)) return val
  const valueUsedInTransform = roundOff(val, 2)
  return intersectCallWrapper({
    fnName: 'angledLineThatIntersects',
    angleVal: inputs[0].expr,
    offsetVal: forceValueUsedInTransform || createLiteral(valueUsedInTransform),
    intersectTag: createIdentifier(referenceSegName),
    tag,
    valueUsedInTransform,
  })
}

const setAngleBetweenCreateNode =
  (tranformToType: 'none' | 'xAbs' | 'yAbs'): CreateStdLibSketchCallExpr =>
  ({
    referenceSegName,
    tag,
    forceValueUsedInTransform,
    inputs,
    rawArgs: args,
    referencedSegment,
  }) => {
    const refAngle = referencedSegment
      ? getAngle(referencedSegment?.from, referencedSegment?.to)
      : 0
    const val = asNum(args[0].expr.value)
    if (err(val)) return val
    let valueUsedInTransform = roundOff(normaliseAngle(val - refAngle))
    let firstHalfValue = createSegAngle(referenceSegName)
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
      forceValueUsedInTransform || createLiteral(valueUsedInTransform),
    ])
    return createCallWrapper(
      tranformToType === 'none'
        ? 'angledLine'
        : tranformToType === 'xAbs'
        ? 'angledLineToX'
        : 'angledLineToY',
      tranformToType === 'none'
        ? [binExp, args[1].expr]
        : tranformToType === 'xAbs'
        ? [binExp, inputs[0].expr]
        : [binExp, inputs[1].expr],
      tag,
      valueUsedInTransform
    )
  }

const transformMap: TransformMap = {
  line: {
    xRelative: {
      equalLength: {
        tooltip: 'line',
        createNode: ({ referenceSegName, inputs, tag, rawArgs: args }) => {
          const [minVal, legLenVal] = getMinAndSegLenVals(
            referenceSegName,
            inputs[0].expr
          )
          return createCallWrapper(
            'line',
            [minVal, getSignedLeg(args[1].expr, legLenVal)],
            tag
          )
        },
      },
      horizontal: {
        tooltip: 'xLine',
        createNode: ({ inputs, tag }) =>
          createCallWrapper('xLine', inputs[0].expr, tag),
      },
      setVertDistance: {
        tooltip: 'lineTo',
        createNode: setHorzVertDistanceConstraintLineCreateNode(false),
      },
    },
    yRelative: {
      equalLength: {
        tooltip: 'line',
        createNode: ({ referenceSegName, inputs, tag, rawArgs: args }) => {
          const [minVal, legLenVal] = getMinAndSegLenVals(
            referenceSegName,
            inputs[1].expr
          )
          return createCallWrapper(
            'line',
            [getSignedLeg(args[0].expr, legLenVal), minVal],
            tag
          )
        },
      },
      vertical: {
        tooltip: 'yLine',
        createNode: ({ inputs, tag }) =>
          createCallWrapper('yLine', inputs[1].expr, tag),
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
        createNode: ({ tag, rawArgs: args }) =>
          createCallWrapper('xLine', args[0].expr, tag),
      },
      vertical: {
        tooltip: 'yLine',
        createNode: ({ tag, rawArgs: args }) =>
          createCallWrapper(
            'yLine',
            getInputOfType(args, 'yRelative').expr,
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
        createNode: ({ tag, rawArgs: args }) =>
          createCallWrapper('xLineTo', args[0].expr, tag),
      },
      vertical: {
        tooltip: 'yLineTo',
        createNode: ({ tag, rawArgs: args }) =>
          createCallWrapper(
            'yLineTo',
            getInputOfType(args, 'yAbsolute').expr,
            tag
          ),
      },
      xAbs: {
        tooltip: 'lineTo',
        createNode: setAbsDistanceCreateNode('x'),
      },
      yAbs: {
        tooltip: 'lineTo',
        createNode: setAbsDistanceCreateNode('y'),
      },
    },
    xAbsolute: {
      equalLength: {
        tooltip: 'angledLineToX',
        createNode: ({ referenceSegName, inputs, tag, rawArgs: args }) => {
          const angleToMatchLengthXCall = createCallExpression(
            'angleToMatchLengthX',
            [
              createIdentifier(referenceSegName),
              inputs[0].expr,
              createPipeSubstitution(),
            ]
          )
          const val = asNum(args[0].expr.value)
          if (err(val)) return val
          return createCallWrapper(
            'angledLineToX',
            [getAngleLengthSign(val, angleToMatchLengthXCall), inputs[0].expr],
            tag
          )
        },
      },
      horizontal: {
        tooltip: 'xLineTo',
        createNode: ({ inputs, tag }) =>
          createCallWrapper('xLineTo', inputs[0].expr, tag),
      },
      setAngleBetween: {
        tooltip: 'angledLineToX',
        createNode: setAngleBetweenCreateNode('xAbs'),
      },
    },
    yAbsolute: {
      equalLength: {
        tooltip: 'angledLineToY',
        createNode: ({ referenceSegName, inputs, tag, rawArgs: args }) => {
          const angleToMatchLengthYCall = createCallExpression(
            'angleToMatchLengthY',
            [
              createIdentifier(referenceSegName),
              inputs[1].expr,
              createPipeSubstitution(),
            ]
          )
          const val = asNum(args[0].expr.value)
          if (err(val)) return val
          return createCallWrapper(
            'angledLineToY',
            [getAngleLengthSign(val, angleToMatchLengthYCall), inputs[1].expr],
            tag
          )
        },
      },
      vertical: {
        tooltip: 'yLineTo',
        createNode: ({ inputs, tag }) =>
          createCallWrapper('yLineTo', inputs[1].expr, tag),
      },
      setAngle: {
        tooltip: 'angledLineToY',
        createNode: ({
          inputs,
          tag,
          forceValueUsedInTransform,
          rawArgs: args,
        }) => {
          const val = asNum(args[0].expr.value)
          if (err(val)) return val
          return createCallWrapper(
            'angledLineToY',
            [forceValueUsedInTransform || args[0].expr, inputs[1].expr],
            tag,
            val
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
        createNode: ({ referenceSegName, inputs, tag }) =>
          createCallWrapper(
            'angledLine',
            [inputs[0].expr, createSegLen(referenceSegName)],
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
        createNode: ({ tag, rawArgs: args }) =>
          createCallWrapper(
            'yLine',
            getInputOfType(args, 'yRelative').expr,
            tag
          ),
      },
      horizontal: {
        tooltip: 'xLine',
        createNode: ({ tag, rawArgs: args }) =>
          createCallWrapper('xLine', args[0].expr, tag),
      },
    },
    length: {
      vertical: {
        tooltip: 'yLine',
        createNode: ({ inputs, tag, rawArgs: args }) => {
          const expr = inputs[1].expr
          if (forceNum(args[0].expr) >= 0)
            return createCallWrapper('yLine', expr, tag)
          if (isExprBinaryPart(expr))
            return createCallWrapper('yLine', createUnaryExpression(expr), tag)
          // TODO maybe should return error here instead
          return createCallWrapper('yLine', expr, tag)
        },
      },
      horizontal: {
        tooltip: 'xLine',
        createNode: ({ inputs, tag, rawArgs: args }) => {
          const expr = inputs[1].expr
          if (forceNum(args[0].expr) >= 0)
            return createCallWrapper('xLine', expr, tag)
          if (isExprBinaryPart(expr))
            return createCallWrapper('xLine', createUnaryExpression(expr), tag)
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
        createNode: ({ tag, rawArgs: args }) =>
          createCallWrapper('xLine', args[0].expr, tag),
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
        createNode: ({ referenceSegName, inputs, tag, rawArgs: args }) => {
          const [minVal, legAngle] = getMinAndSegAngVals(
            referenceSegName,
            getInputOfType(inputs, 'xRelative').expr
          )
          const val = asNum(args[0].expr.value)
          if (err(val)) return val
          return createCallWrapper(
            'angledLineOfXLength',
            [getLegAng(val, legAngle), minVal],
            tag
          )
        },
      },
      horizontal: {
        tooltip: 'xLine',
        createNode: ({ inputs, tag, rawArgs: args }) => {
          const expr = inputs[1].expr
          if (forceNum(args[0].expr) >= 0)
            return createCallWrapper('xLine', expr, tag)
          if (isExprBinaryPart(expr))
            return createCallWrapper('xLine', createUnaryExpression(expr), tag)
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
        createNode: ({ tag, rawArgs: args }) =>
          createCallWrapper(
            'yLine',
            getInputOfType(args, 'yRelative').expr,
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
        createNode: ({ referenceSegName, inputs, tag, rawArgs: args }) => {
          const [minVal, legAngle] = getMinAndSegAngVals(
            referenceSegName,
            inputs[1].expr,
            'legAngY'
          )
          const val = asNum(args[0].expr.value)
          if (err(val)) return val
          return createCallWrapper(
            'angledLineOfXLength',
            [getLegAng(val, legAngle), minVal],
            tag
          )
        },
      },
      vertical: {
        tooltip: 'yLine',
        createNode: ({ inputs, tag, rawArgs: args }) => {
          const expr = inputs[1].expr
          if (forceNum(args[0].expr) >= 0)
            return createCallWrapper('yLine', expr, tag)
          if (isExprBinaryPart(expr))
            return createCallWrapper('yLine', createUnaryExpression(expr), tag)
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
        createNode: ({ tag, rawArgs: args }) =>
          createCallWrapper('xLineTo', args[0].expr, tag),
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
        createNode: ({ referenceSegName, inputs, tag, rawArgs: args }) => {
          const angleToMatchLengthXCall = createCallExpression(
            'angleToMatchLengthX',
            [
              createIdentifier(referenceSegName),
              inputs[1].expr,
              createPipeSubstitution(),
            ]
          )
          const val = asNum(args[0].expr.value)
          if (err(val)) return val
          return createCallWrapper(
            'angledLineToX',
            [getAngleLengthSign(val, angleToMatchLengthXCall), inputs[1].expr],
            tag
          )
        },
      },
      horizontal: {
        tooltip: 'xLineTo',
        createNode: ({ inputs, tag }) =>
          createCallWrapper('xLineTo', inputs[1].expr, tag),
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
        createNode: ({ tag, rawArgs: args }) =>
          createCallWrapper(
            'yLineTo',
            getInputOfType(args, 'yAbsolute').expr,
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
        createNode: ({ referenceSegName, inputs, tag, rawArgs: args }) => {
          const angleToMatchLengthXCall = createCallExpression(
            'angleToMatchLengthY',
            [
              createIdentifier(referenceSegName),
              inputs[1].expr,
              createPipeSubstitution(),
            ]
          )
          const val = asNum(args[0].expr.value)
          if (err(val)) return val
          return createCallWrapper(
            'angledLineToY',
            [getAngleLengthSign(val, angleToMatchLengthXCall), inputs[1].expr],
            tag
          )
        },
      },
      vertical: {
        tooltip: 'yLineTo',
        createNode: ({ inputs, tag }) =>
          createCallWrapper('yLineTo', inputs[1].expr, tag),
      },
    },
  },
  xLine: {
    free: {
      equalLength: {
        tooltip: 'xLine',
        createNode: ({ referenceSegName, tag, rawArgs: args }) => {
          const argVal = asNum(args[0].expr.value)
          if (err(argVal)) return argVal
          const segLen = createSegLen(referenceSegName)
          if (argVal > 0) return createCallWrapper('xLine', segLen, tag, argVal)
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
        createNode: ({ referenceSegName, tag, rawArgs: args }) => {
          const argVal = asNum(args[0].expr.value)
          if (err(argVal)) return argVal
          let segLen = createSegLen(referenceSegName)
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
        createNode: ({ referenceSegName, tag }) =>
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
        createNode: ({ referenceSegName, tag }) =>
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
    createNode: ({ tag, referenceSegName, rawArgs: args }) => {
      return createCallWrapper('line', [args[0].expr, args[1].expr], tag)
      // The following commented changes values to hardcode, but keeps the line type the same, maybe that's useful?

      //   if (name === 'angledLineThatIntersects') {
      //     return intersectCallWrapper({
      //       fnName: name,
      //       angleVal: args[0].expr,
      //       offsetVal: args[1].expr,
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
    createNode: ({ tag, inputs, rawArgs }) => {
      // inputs is the current values for each of the inputs
      // rawValues is the raw 'literal' values equivalent to the inputs
      // inputDetails is the one variable we're removing the constraint from
      // So we should update the call expression to use the inputs, except for
      // the inputDetails, input where we should use the rawValue(s)

      if (inputDetails.type === 'arrayItem') {
        const values = inputs.map((arg) => {
          if (
            !(
              (arg.type === 'arrayItem' || arg.type === 'arrayOrObjItem') &&
              arg.index === inputDetails.index
            )
          )
            return arg.expr
          const literal = rawArgs.find(
            (rawValue) =>
              (rawValue.type === 'arrayItem' ||
                rawValue.type === 'arrayOrObjItem') &&
              rawValue.index === inputDetails.index
          )?.expr
          return (arg.index === inputDetails.index && literal) || arg.expr
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
        inputs.forEach((arg) => {
          if (
            arg.type !== 'objectProperty' &&
            arg.type !== 'arrayOrObjItem' &&
            arg.type !== 'arrayInObject'
          )
            return
          const rawLiteralArrayInObject = rawArgs.find(
            (rawValue) =>
              rawValue.type === 'arrayInObject' &&
              rawValue.key === inputDetails.key &&
              rawValue.index === (arg.type === 'arrayInObject' ? arg.index : -1)
          )
          const rawLiteralObjProp = rawArgs.find(
            (rawValue) =>
              (rawValue.type === 'objectProperty' ||
                rawValue.type === 'arrayOrObjItem' ||
                rawValue.type === 'arrayInObject') &&
              rawValue.key === inputDetails.key
          )
          if (
            inputDetails.type === 'arrayInObject' &&
            rawLiteralArrayInObject?.type === 'arrayInObject' &&
            rawLiteralArrayInObject?.index === inputDetails.index &&
            rawLiteralArrayInObject?.key === inputDetails.key
          ) {
            if (!arrayDetailsNameBetterLater[arg.key])
              arrayDetailsNameBetterLater[arg.key] = []
            arrayDetailsNameBetterLater[inputDetails.key][inputDetails.index] =
              rawLiteralArrayInObject.expr
          } else if (
            inputDetails.type === 'objectProperty' &&
            (rawLiteralObjProp?.type === 'objectProperty' ||
              rawLiteralObjProp?.type === 'arrayOrObjItem') &&
            rawLiteralObjProp?.key === inputDetails.key &&
            arg.key === inputDetails.key
          ) {
            otherThing[inputDetails.key] = rawLiteralObjProp.expr
          } else if (arg.type === 'arrayInObject') {
            if (!arrayDetailsNameBetterLater[arg.key])
              arrayDetailsNameBetterLater[arg.key] = []
            arrayDetailsNameBetterLater[arg.key][arg.index] = arg.expr
          } else if (arg.type === 'objectProperty') {
            otherThing[arg.key] = arg.expr
          }
        })
        const createObjParam: Parameters<typeof createObjectExpression>[0] = {}
        Object.entries(arrayDetailsNameBetterLater).forEach(([key, value]) => {
          createObjParam[key] = createArrayExpression(value)
        })
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
        rawArgs[0].expr,
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
  const nodes = selectionRanges.graphSelections.map(({ codeRef }) =>
    getNodeFromPath<Expr>(ast, codeRef.pathToNode, 'CallExpression')
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
  const nodes = selectionRanges.graphSelections.map(({ codeRef }) =>
    getNodeFromPath<Expr>(ast, codeRef.pathToNode)
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
  ast: Node<Program>
  selectionRanges: Selections
  transformInfos: TransformInfo[]
  programMemory: ProgramMemory
  forceSegName?: string
  forceValueUsedInTransform?: BinaryPart
}):
  | {
      modifiedAst: Node<Program>
      valueUsedInTransform?: number
      pathToNodeMap: PathToNodeMap
      tagInfo: {
        tag: string
        isTagExisting: boolean
      }
    }
  | Error {
  // let node = structuredClone(ast)

  // We need to sort the selections by their start position
  // so that we can process them in dependency order and not write invalid KCL.
  const sortedCodeBasedSelections = selectionRanges.graphSelections.toSorted(
    (a, b) => a?.codeRef?.range[0] - b?.codeRef?.range[0]
  )
  const primarySelection = sortedCodeBasedSelections[0]?.codeRef?.range
  const secondarySelections = sortedCodeBasedSelections.slice(1)

  const _tag = giveSketchFnCallTag(ast, primarySelection, forceSegName)
  if (err(_tag)) return _tag
  const { modifiedAst, tag, isTagExisting, pathToNode } = _tag

  const result = transformAstSketchLines({
    ast: modifiedAst,
    selectionRanges: {
      ...selectionRanges,
      graphSelections: secondarySelections,
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
  ast: Node<Program>
  selectionRanges: Selections | PathToNode[]
  transformInfos: TransformInfo[]
  programMemory: ProgramMemory
  referenceSegName: string
  referencedSegmentRange?: SourceRange
  forceValueUsedInTransform?: BinaryPart
}):
  | {
      modifiedAst: Node<Program>
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

    const callExp = getNode<Node<CallExpression>>('CallExpression')
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
    const inputs: InputArgs = []

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
          type: 'arrayItem',
          index: a.argPosition.index,
          expr: nodeMeta.node,
          argType: a.type,
        })
      } else if (a?.argPosition?.type === 'objectProperty') {
        inputs.push({
          type: 'objectProperty',
          key: a.argPosition.key,
          expr: nodeMeta.node,
          argType: a.type,
        })
      } else if (a?.argPosition?.type === 'singleValue') {
        inputs.push({
          type: 'singleValue',
          argType: a.type,
          expr: nodeMeta.node,
        })
      } else if (a?.argPosition?.type === 'arrayInObject') {
        inputs.push({
          type: 'arrayInObject',
          key: a.argPosition.key,
          index: a.argPosition.index,
          expr: nodeMeta.node,
          argType: a.type,
        })
      }
    })

    const varName = varDec.node.id.name
    let kclVal = programMemory.get(varName)
    let sketch
    if (kclVal?.type === 'Solid') {
      sketch = kclVal.sketch
    } else {
      sketch = sketchFromKclValue(kclVal, varName)
      if (err(sketch)) {
        return
      }
    }
    const segMeta = getSketchSegmentFromPathToNode(sketch, ast, _pathToNode)
    if (err(segMeta)) return segMeta

    const seg = segMeta.segment
    let referencedSegment
    if (referencedSegmentRange) {
      const _segment = getSketchSegmentFromSourceRange(
        sketch,
        referencedSegmentRange
      )
      if (err(_segment)) return _segment
      referencedSegment = _segment.segment
    } else {
      referencedSegment = sketch.paths.find(
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

      replaceExistingCallback: (rawArgs) =>
        callBack({
          referenceSegName: _referencedSegmentName,
          inputs,
          tag: callBackTag,
          rawArgs,
          forceValueUsedInTransform,
          referencedSegment,
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

  if ('graphSelections' in selectionRanges) {
    // If the processing of any of the selections failed, return the first error
    const maybeProcessErrors = selectionRanges.graphSelections
      .map(({ codeRef }, index) =>
        processSelection(getNodePathFromSourceRange(node, codeRef.range), index)
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

function createSegLen(referenceSegName: string): BinaryPart {
  return createCallExpression('segLen', [createIdentifier(referenceSegName)])
}

function createSegAngle(referenceSegName: string): BinaryPart {
  return createCallExpression('segAng', [createIdentifier(referenceSegName)])
}

function createSegEnd(
  referenceSegName: string,
  isX: boolean
): Node<CallExpression> {
  return createCallExpression(isX ? 'segEndX' : 'segEndY', [
    createIdentifier(referenceSegName),
  ])
}

function createLastSeg(isX: boolean): Node<CallExpression> {
  return createCallExpression(isX ? 'lastSegX' : 'lastSegY', [
    createPipeSubstitution(),
  ])
}

export type ConstraintLevel = 'free' | 'partial' | 'full'

export function getConstraintLevelFromSourceRange(
  cursorRange: SourceRange,
  ast: Program | Error
): Error | { range: [number, number]; level: ConstraintLevel } {
  if (err(ast)) return ast
  const nodeMeta = getNodeFromPath<Node<CallExpression>>(
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

export function isExprBinaryPart(expr: Expr): expr is BinaryPart {
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

function getInputOfType(a: InputArgs, b: LineInputsType | 'radius'): InputArg {
  return a.find(({ argType }) => argType === b) || a[0]
}
