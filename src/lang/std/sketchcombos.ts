import { TransformCallback, VarValues } from './stdTypes'
import { toolTips, ToolTip } from '../../useStore'
import { Selections, Selection } from 'lib/selections'
import {
  CallExpression,
  Program,
  Value,
  BinaryPart,
  VariableDeclarator,
  PathToNode,
  ProgramMemory,
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
  a: ToolTip,
  val: [Value, Value] | Value,
  tag?: Value,
  valueUsedInTransform?: number
): ReturnType<TransformCallback> {
  const args = [createFirstArg(a, val), createPipeSubstitution()]
  if (tag) {
    args.push(tag)
  }
  return {
    callExp: createCallExpression(a, args),
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
  val: Value,
  tag?: Value,
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
  angleVal: Value
  offsetVal: Value
  intersectTag: Value
  tag?: Value
  valueUsedInTransform?: number
}): ReturnType<TransformCallback> {
  const firstArg: any = {
    angle: angleVal,
    offset: offsetVal,
    intersectTag,
  }
  const args: Value[] = [
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
    varValues: VarValues
    varValA: Value // x / angle
    varValB: Value // y / length or x y for angledLineOfXlength etc
    referenceSegName: string
    tag?: Value
    forceValueUsedInTransform?: Value
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
      : args[0]
    return createCallWrapper(xOrY, lineVal, tag, getArgLiteralVal(args[0]))
  }

const basicAngledLineCreateNode =
  (
    referenceSeg: 'ang' | 'len' | 'none' = 'none',
    valToForce: 'ang' | 'len' | 'none' = 'none',
    varValToUse: 'ang' | 'len' | 'none' = 'none'
  ): TransformInfo['createNode'] =>
  ({ referenceSegName, tag, forceValueUsedInTransform, varValA, varValB }) =>
  (args, _, path) => {
    const refAng = path ? getAngle(path?.from, path?.to) : 0
    const nonForcedAng =
      varValToUse === 'ang'
        ? varValA
        : referenceSeg === 'ang'
        ? getClosesAngleDirection(
            args[0],
            refAng,
            createSegAngle(referenceSegName) as BinaryPart
          )
        : args[0]
    const nonForcedLen =
      varValToUse === 'len'
        ? varValB
        : referenceSeg === 'len'
        ? createSegLen(referenceSegName)
        : args[1]
    const shouldForceAng = valToForce === 'ang' && forceValueUsedInTransform
    const shouldForceLen = valToForce === 'len' && forceValueUsedInTransform
    return createCallWrapper(
      'angledLine',
      [
        shouldForceAng ? forceValueUsedInTransform : nonForcedAng,
        shouldForceLen ? forceValueUsedInTransform : nonForcedLen,
      ],
      tag,
      getArgLiteralVal(valToForce === 'ang' ? args[0] : args[1])
    )
  }
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
  const binExp = createBinaryExpressionWithUnary([
    createLiteral(truncatedTo90),
    legAngleVal,
  ])
  return truncatedTo90 === 0 ? legAngleVal : binExp
}

const getAngleLengthSign = (arg: Value, legAngleVal: BinaryPart) => {
  const ang = (arg.type === 'Literal' && Number(arg.value)) || 0
  const normalisedAngle = ((ang % 180) + 180) % 180 // between 0 and 180
  return normalisedAngle > 90 ? createUnaryExpression(legAngleVal) : legAngleVal
}

function getClosesAngleDirection(
  arg: Value,
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
    return (args, _, referencedSegment) => {
      const valueUsedInTransform = roundOff(
        getArgLiteralVal(args?.[index]) - (referencedSegment?.to?.[index] || 0),
        2
      )
      let finalValue: Value = createBinaryExpressionWithUnary([
        createSegEnd(referenceSegName, !index),
        (forceValueUsedInTransform as BinaryPart) ||
          createLiteral(valueUsedInTransform),
      ])
      if (isValueZero(forceValueUsedInTransform)) {
        finalValue = createSegEnd(referenceSegName, !index)
      }
      return createCallWrapper(
        'lineTo',
        !index ? [finalValue, args[1]] : [args[0], finalValue],
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
  ({ referenceSegName, tag, forceValueUsedInTransform, varValA }) => {
    return (args, _, referencedSegment) => {
      const valueUsedInTransform = roundOff(
        getArgLiteralVal(args?.[1]) - (referencedSegment?.to?.[index] || 0),
        2
      )
      const binExp = createBinaryExpressionWithUnary([
        createSegEnd(referenceSegName, !index),
        (forceValueUsedInTransform as BinaryPart) ||
          createLiteral(valueUsedInTransform),
      ])
      return createCallWrapper(
        xOrY === 'x' ? 'angledLineToX' : 'angledLineToY',
        [varValA, binExp],
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
  ({ tag, forceValueUsedInTransform }) => {
    return (args, _, referencedSegment) => {
      const valueUsedInTransform = roundOff(
        getArgLiteralVal(args?.[index]) - (referencedSegment?.to?.[index] || 0),
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
        !index ? [val, args[1]] : [args[0], val],
        tag,
        valueUsedInTransform
      )
    }
  }
const setAbsDistanceForAngleLineCreateNode =
  (
    xOrY: 'x' | 'y',
    index = xOrY === 'x' ? 0 : 1
  ): TransformInfo['createNode'] =>
  ({ tag, forceValueUsedInTransform, varValA }) => {
    return (args) => {
      const valueUsedInTransform = roundOff(getArgLiteralVal(args?.[1]), 2)
      const val =
        (forceValueUsedInTransform as BinaryPart) ||
        createLiteral(valueUsedInTransform)
      return createCallWrapper(
        xOrY === 'x' ? 'angledLineToX' : 'angledLineToY',
        [varValA, val],
        tag,
        valueUsedInTransform
      )
    }
  }

const setHorVertDistanceForXYLines =
  (xOrY: 'x' | 'y'): TransformInfo['createNode'] =>
  ({ referenceSegName, tag, forceValueUsedInTransform }) => {
    return (args, _, referencedSegment) => {
      const index = xOrY === 'x' ? 0 : 1
      const valueUsedInTransform = roundOff(
        getArgLiteralVal(args?.[index]) - (referencedSegment?.to?.[index] || 0),
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
  ({ referenceSegName, tag, varValA, varValB }) => {
    const varVal = (isX ? varValB : varValA) as BinaryPart
    const varValBinExp = createBinaryExpressionWithUnary([
      createLastSeg(!isX),
      varVal,
    ])

    return (args, _, referencedSegment) => {
      const makeBinExp = (index: 0 | 1) => {
        const arg = getArgLiteralVal(args?.[index])
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
      args[1].type === 'Literal' ? Number(args[1].value) : 0,
      2
    )
    const angle = args[0].type === 'Literal' ? Number(args[0].value) : 0
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
      intersectTag: createLiteral(referenceSegName),
      tag,
      valueUsedInTransform,
    })
  }

const setAngledIntersectForAngledLines: TransformInfo['createNode'] =
  ({ referenceSegName, tag, forceValueUsedInTransform, varValA }) =>
  (args) => {
    const valueUsedInTransform = roundOff(
      args[1].type === 'Literal' ? Number(args[1].value) : 0,
      2
    )
    // const angle = args[0].type === 'Literal' ? Number(args[0].value) : 0
    return intersectCallWrapper({
      fnName: 'angledLineThatIntersects',
      angleVal: varValA,
      offsetVal:
        forceValueUsedInTransform || createLiteral(valueUsedInTransform),
      intersectTag: createLiteral(referenceSegName),
      tag,
      valueUsedInTransform,
    })
  }

const setAngleBetweenCreateNode =
  (tranformToType: 'none' | 'xAbs' | 'yAbs'): TransformInfo['createNode'] =>
  ({ referenceSegName, tag, forceValueUsedInTransform, varValA, varValB }) => {
    return (args, _, referencedSegment) => {
      const refAngle = referencedSegment
        ? getAngle(referencedSegment?.from, referencedSegment?.to)
        : 0
      let valueUsedInTransform = roundOff(
        normaliseAngle(
          (args[0].type === 'Literal' ? Number(args[0].value) : 0) - refAngle
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
          ? [binExp, args[1]]
          : tranformToType === 'xAbs'
          ? [binExp, varValA]
          : [binExp, varValB],
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
        createNode: basicAngledLineCreateNode('len'),
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
      setAngleBetween: {
        tooltip: 'angledLineToX',
        createNode: setAngleBetweenCreateNode('xAbs'),
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
      setAngle: {
        tooltip: 'angledLineToY',
        createNode:
          ({ varValB, tag, forceValueUsedInTransform }) =>
          (args) => {
            return createCallWrapper(
              'angledLineToY',
              [forceValueUsedInTransform || args[0], varValB],
              tag,
              getArgLiteralVal(args[0])
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
          ({ referenceSegName, varValA, tag }) =>
          () =>
            createCallWrapper(
              'angledLine',
              [varValA, createSegLen(referenceSegName)],
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
        createNode: basicAngledLineCreateNode('len'),
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
        createNode: basicAngledLineCreateNode('len'),
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
        createNode: basicAngledLineCreateNode('len'),
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
          (arg) => {
            const argVal = getArgLiteralVal(arg[0])
            const segLen = createSegLen(referenceSegName) as BinaryPart
            const val = argVal > 0 ? segLen : createUnaryExpression(segLen)
            return createCallWrapper('xLine', val, tag, argVal)
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
            const argVal = getArgLiteralVal(arg[0])
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
        return createCallWrapper('line', args, tag)
        // The following commented changes values to hardcode, but keeps the line type the same, maybe that's useful?

        //   if (name === 'angledLineThatIntersects') {
        //     return intersectCallWrapper({
        //       fnName: name,
        //       angleVal: args[0],
        //       offsetVal: args[1],
        //       intersectTag: createLiteral(referenceSegName),
        //       tag,
        //     })
        //   }
        //   return createCallWrapper(name, args, tag)
      },
  }

  // check if the function is locked down and so can't be transformed
  const firstArg = getFirstArg(sketchFnExp)
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
  arrayIndex,
  objectProperty,
  ast,
}: {
  pathToCallExp: PathToNode
  arrayIndex?: number
  objectProperty?: string
  ast: Program
}): TransformInfo | false {
  const callExp = getNodeFromPath<CallExpression>(
    ast,
    pathToCallExp,
    'CallExpression'
  ).node
  if (callExp.type !== 'CallExpression') throw new Error('Invalid node type')

  const transform: TransformInfo = {
    tooltip: callExp.callee.name as any,
    createNode:
      ({ tag, referenceSegName, varValues }) =>
      (_, rawValues) => {
        if (objectProperty) {
          const expression: Parameters<typeof createObjectExpression>[0] = {}
          varValues.forEach((varValue) => {
            if (
              varValue.type !== 'objectProperty' &&
              varValue.type !== 'arrayOrObjItem'
            )
              return
            const literal = rawValues.find(
              (rawValue) =>
                (rawValue.type === 'objectProperty' ||
                  rawValue.type === 'arrayOrObjItem') &&
                rawValue.key === objectProperty
            )?.value
            const value =
              (varValue.key === objectProperty && literal) || varValue.value
            expression[varValue.key] = value
          })
          const objExp = createObjectExpression(expression)
          return createStdlibCallExpression(
            callExp.callee.name as any,
            objExp,
            tag
          )
        }
        if (typeof arrayIndex === 'number') {
          const values = varValues.map((varValue) => {
            if (
              (varValue.type === 'arrayItem' ||
                varValue.type === 'arrayOrObjItem') &&
              varValue.index === arrayIndex
            ) {
              const literal = rawValues.find(
                (rawValue) =>
                  (rawValue.type === 'arrayItem' ||
                    rawValue.type === 'arrayOrObjItem') &&
                  rawValue.index === arrayIndex
              )?.value
              return (
                (varValue.index === arrayIndex && literal) || varValue.value
              )
            }
            return varValue.value
          })
          return createStdlibCallExpression(
            callExp.callee.name as any,
            createArrayExpression(values),
            tag
          )
        }

        // if (typeof arrayIndex !== 'number' || !objectProperty) must be single value input xLine, yLineTo etc

        return createCallWrapper(
          callExp.callee.name as any,
          rawValues[0].value,
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
  val: Value | [Value, Value] | [Value, Value, Value],
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
  const nodes = paths.map(
    (pathToNode) =>
      getNodeFromPath<Value>(ast, pathToNode, 'CallExpression').node
  )

  try {
    const theTransforms = nodes.map((node) => {
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
): TransformInfo[] {
  // return ()
  const paths = selectionRanges.codeBasedSelections.map((selectionRange) =>
    getNodePathFromSourceRange(ast, selectionRange.range)
  )
  const nodes = paths.map(
    (pathToNode) => getNodeFromPath<Value>(ast, pathToNode).node
  )

  const theTransforms = nodes.map((node) => {
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
  forceValueUsedInTransform?: Value
}): {
  modifiedAst: Program
  valueUsedInTransform?: number
  pathToNodeMap: PathToNodeMap
  tagInfo: {
    tag: string
    isTagExisting: boolean
  }
} {
  // let node = JSON.parse(JSON.stringify(ast))
  const primarySelection = selectionRanges.codeBasedSelections[0].range

  const { modifiedAst, tag, isTagExisting, pathToNode } = giveSketchFnCallTag(
    ast,
    primarySelection,
    forceSegName
  )

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
  forceValueUsedInTransform?: Value
  referencedSegmentRange?: Selection['range']
}): {
  modifiedAst: Program
  valueUsedInTransform?: number
  pathToNodeMap: PathToNodeMap
} {
  // deep clone since we are mutating in a loop, of which any could fail
  let node = JSON.parse(JSON.stringify(ast))
  let _valueUsedInTransform // TODO should this be an array?
  const pathToNodeMap: PathToNodeMap = {}

  const processSelection = (_pathToNode: PathToNode, index: number) => {
    const callBack = transformInfos?.[index].createNode
    const transformTo = transformInfos?.[index].tooltip

    if (!callBack || !transformTo) throw new Error('no callback helper')

    const getNode = getNodeFromPathCurry(node, _pathToNode)

    const callExp = getNode<CallExpression>('CallExpression')?.node
    const varDec = getNode<VariableDeclarator>('VariableDeclarator').node

    const { val } = getFirstArg(callExp)
    const callBackTag = callExp.arguments[2]
    const _referencedSegmentNameVal =
      callExp.arguments[0]?.type === 'ObjectExpression' &&
      callExp.arguments[0].properties?.find(
        (prop) => prop.key.name === 'intersectTag'
      )?.value
    const _referencedSegmentName =
      referenceSegName ||
      (_referencedSegmentNameVal &&
        _referencedSegmentNameVal.type === 'Literal' &&
        String(_referencedSegmentNameVal.value)) ||
      ''
    const [varValA, varValB] = Array.isArray(val) ? val : [val, val]

    const varValues: VarValues = []

    getConstraintInfo(callExp, '', _pathToNode).forEach((a) => {
      if (
        a.type === 'tangentialWithPrevious' ||
        a.type === 'horizontal' ||
        a.type === 'vertical'
      )
        return
      if (a?.argPosition?.type === 'arrayItem') {
        varValues.push({
          type: 'arrayItem',
          index: a.argPosition.index,
          value: getNodeFromPath<Value>(ast, a.pathToNode).node,
          argType: a.type,
        })
      } else if (a?.argPosition?.type === 'objectProperty') {
        varValues.push({
          type: 'objectProperty',
          key: a.argPosition.key,
          value: getNodeFromPath<Value>(ast, a.pathToNode).node,
          argType: a.type,
        })
      } else if (a?.argPosition?.type === 'singleValue') {
        varValues.push({
          type: 'singleValue',
          argType: a.type,
          value: getNodeFromPath<Value>(ast, a.pathToNode).node,
        })
      }
    })

    const varName = varDec.id.name
    const sketchGroup = programMemory.root?.[varName]
    if (!sketchGroup || sketchGroup.type !== 'SketchGroup')
      throw new Error('not a sketch group')
    const seg = getSketchSegmentFromPathToNode(
      sketchGroup,
      ast,
      _pathToNode
    ).segment
    const referencedSegment = referencedSegmentRange
      ? getSketchSegmentFromSourceRange(sketchGroup, referencedSegmentRange)
          .segment
      : sketchGroup.value.find((path) => path.name === _referencedSegmentName)
    const { to, from } = seg
    const { modifiedAst, valueUsedInTransform, pathToNode } = replaceSketchLine(
      {
        node: node,
        programMemory,
        pathToNode: _pathToNode,
        referencedSegment,
        fnName: transformTo || (callExp.callee.name as ToolTip),
        to,
        from,
        createCallback: callBack({
          referenceSegName: _referencedSegmentName,
          varValues,
          varValA,
          varValB,
          tag: callBackTag,
          forceValueUsedInTransform,
        }),
      }
    )

    node = modifiedAst
    pathToNodeMap[index] = pathToNode
    if (typeof valueUsedInTransform === 'number') {
      _valueUsedInTransform = valueUsedInTransform
    }
  }

  if ('codeBasedSelections' in selectionRanges) {
    selectionRanges.codeBasedSelections.forEach(({ range }, index) =>
      processSelection(getNodePathFromSourceRange(node, range), index)
    )
  } else {
    selectionRanges.forEach(processSelection)
  }

  return {
    modifiedAst: node,
    valueUsedInTransform: _valueUsedInTransform,
    pathToNodeMap,
  }
}

function createSegLen(referenceSegName: string): Value {
  return createCallExpression('segLen', [
    createLiteral(referenceSegName),
    createPipeSubstitution(),
  ])
}

function createSegAngle(referenceSegName: string): Value {
  return createCallExpression('segAng', [
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

export function getConstraintLevelFromSourceRange(
  cursorRange: Selection['range'],
  ast: Program
): { range: [number, number]; level: 'free' | 'partial' | 'full' } {
  const { node: sketchFnExp } = getNodeFromPath<CallExpression>(
    ast,
    getNodePathFromSourceRange(ast, cursorRange),
    'CallExpression'
  )
  const name = sketchFnExp?.callee?.name as ToolTip
  const range: [number, number] = [sketchFnExp.start, sketchFnExp.end]
  if (!toolTips.includes(name)) return { level: 'free', range: range }

  const firstArg = getFirstArg(sketchFnExp)

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
  val: Value | [Value, Value] | [Value, Value, Value] | undefined
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
  val: Value | [Value, Value] | [Value, Value, Value]
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
