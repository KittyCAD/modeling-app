import { TransformCallback } from './stdTypes'
import { Range, toolTips, TooTip } from '../../useStore'
import {
  CallExpression,
  getNodeFromPathCurry,
  getNodePathFromSourceRange,
  Program,
  Value,
  VariableDeclarator,
} from '../abstractSyntaxTree'
import {
  createCallExpression,
  createLiteral,
  createPipeSubstitution,
} from '../modifyAst'
import { createFirstArg, getFirstArg, replaceSketchLine } from './sketch'
import { ProgramMemory } from '../executor'
import { getSketchSegmentIndexFromSourceRange } from './sketchConstraints'

type LineInputsType =
  | 'xAbsolute'
  | 'yAbsolute'
  | 'xRelative'
  | 'yRelative'
  | 'angle'
  | 'length'

type ConstraintType = 'equalLength' | 'vertical' | 'horizontal' | 'equalangle'

function createCallWrapper(
  a: TooTip,
  val: [Value, Value] | Value,
  tag?: Value
) {
  return createCallExpression(a, [
    createFirstArg(a, val, tag),
    createPipeSubstitution(),
  ])
}

export function replaceSketchCall(
  programMemory: ProgramMemory,
  ast: Program,
  range: Range,
  createCallback: TransformCallback
): { modifiedAst: Program } {
  const path = getNodePathFromSourceRange(ast, range)
  const getNode = getNodeFromPathCurry(ast, path)
  const varDec = getNode<VariableDeclarator>('VariableDeclarator').node
  const callExp = getNode<CallExpression>('CallExpression').node
  const varName = varDec.id.name
  const sketchGroup = programMemory.root?.[varName]
  if (!sketchGroup || sketchGroup.type !== 'sketchGroup')
    throw new Error('not a sketch group')
  const seg = getSketchSegmentIndexFromSourceRange(sketchGroup, range)
  const { to, from } = seg
  const { modifiedAst } = replaceSketchLine({
    node: ast,
    programMemory,
    sourceRange: range,
    fnName: callExp.callee.name as TooTip,
    to,
    from,
    createCallback,
  })
  return { modifiedAst }
}

export type TransformInfo = {
  tooltip: TooTip
  createNode?: (a: {
    varVal: Value
    referenceSegName: string
  }) => (args: [Value, Value], tag?: Value) => Value
}

type TransformMap = {
  [keya in TooTip]?: {
    [keyb in LineInputsType | 'free']?: {
      [keyc in ConstraintType]?: TransformInfo
    }
  }
}

export const attemptAtThing: TransformMap = {
  line: {
    xRelative: {
      equalLength: {
        tooltip: 'line',
        createNode: ({ referenceSegName, varVal }) => {
          const segLenVal: Value = createCallExpression('segLen', [
            createLiteral(referenceSegName),
            createPipeSubstitution(),
          ])
          const minVal: Value = createCallExpression('min', [segLenVal, varVal])
          const legLenVal: Value = createCallExpression('legLen', [
            segLenVal,
            varVal,
          ])
          return (args, tag) => {
            return createCallWrapper('line', [minVal, legLenVal], tag)
          }
        },
      },
      horizontal: { tooltip: 'xLine' },
      equalangle: { tooltip: 'angledLineOfXLength' },
    },
    yRelative: {
      equalLength: { tooltip: 'line' },
      vertical: { tooltip: 'yLine' },
      equalangle: { tooltip: 'angledLineOfYLength' },
    },
    free: {
      equalLength: { tooltip: 'angledLine' },
      horizontal: { tooltip: 'xLine' },
      vertical: { tooltip: 'yLine' },
      equalangle: { tooltip: 'angledLine' },
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
    const info = attemptAtThing?.[name]?.free?.[constraintType]
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
    const info = attemptAtThing?.[name]?.[lineInputType]?.[constraintType]
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
  const info = attemptAtThing?.[toolTip]?.[lineInputType]?.[_constraintType]
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

// console.log(JSON.stringify(createAllowedTransformMap(), null, 2))
