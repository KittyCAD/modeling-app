import type { Node } from '@rust/kcl-lib/bindings/Node'

import { ARG_TAG } from '@src/lang/constants'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createPipeExpression,
  createTagDeclarator,
  findUniqueName,
} from '@src/lang/create'
import { getNodeFromPath } from '@src/lang/queryAst'
import type { AddTagInfo } from '@src/lang/std/stdTypes'
import {
  type CallExpressionKw,
  type PipeExpression,
  type Program,
  type VariableDeclarator,
} from '@src/lang/wasm'
import { findKwArg } from '@src/lang/util'
import type { EdgeCutInfo } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

const SKETCH_TAGGABLE_HELPERS = [
  'arc',
  'arcTo',
  'line',
  'lineTo',
  'circleThreePoint',
  'circle',
  'xLine',
  'yLine',
  'xLineTo',
  'yLineTo',
  'angledLine',
  'angledLineOfXLength',
  'angledLineOfYLength',
  'angledLineThatIntersects',
  'angledLineToX',
  'angledLineToY',
  'tangentialArc',
  'tangentialArcTo',
  'startProfile',
] as const

export function isTaggableSketchSegment(name: string): boolean {
  return SKETCH_TAGGABLE_HELPERS.includes(
    name as (typeof SKETCH_TAGGABLE_HELPERS)[number]
  )
}

type AddTagFn = (
  a: AddTagInfo
) => { modifiedAst: Node<Program>; tag: string } | Error

export function addTagKw(): AddTagFn {
  return ({ node, pathToNode, wasmInstance }) => {
    const _node = { ...node }
    const callExpr = getNodeFromPath<Node<CallExpressionKw>>(
      _node,
      pathToNode,
      wasmInstance,
      ['CallExpressionKw']
    )
    if (err(callExpr)) return callExpr

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

    const mustReplaceNode = primaryCallExp.type !== callExpr.node.type
    if (mustReplaceNode) {
      getNodeFromPath(
        _node,
        pathToNode,
        wasmInstance,
        ['CallExpressionKw'],
        false,
        false,
        {
          ...primaryCallExp,
          start: callExpr.node.start,
          end: callExpr.node.end,
          moduleId: callExpr.node.moduleId,
          outerAttrs: callExpr.node.outerAttrs,
          commentStart: callExpr.node.start,
        }
      )
    }

    if ('value' in tagDeclarator) {
      return {
        modifiedAst: _node,
        tag: String(tagDeclarator.value),
      }
    }
    return new Error('Unable to assign tag without value')
  }
}

function addTagToEdgeCut(
  tagInfo: AddTagInfo,
  edgeCutMeta: EdgeCutInfo,
  wasmInstance: ModuleType
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
    wasmInstance,
    'PipeExpression'
  )
  const variableDec = getNodeFromPath<VariableDeclarator>(
    _node,
    tagInfo.pathToNode,
    wasmInstance,
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

  const tagIndexToPullOut = inputTags.elements.findIndex((tag) => {
    const elementMatchesBaseTagType =
      edgeCutMeta?.subType === 'base' &&
      tag.type === 'Name' &&
      tag.name.name === edgeCutMeta.tagName
    if (elementMatchesBaseTagType) return true

    const tagMatchesOppositeTagType =
      edgeCutMeta?.subType === 'opposite' &&
      tag.type === 'CallExpressionKw' &&
      tag.callee.name.name === 'getOppositeEdge' &&
      tag.unlabeled?.type === 'Name' &&
      tag.unlabeled.name.name === edgeCutMeta.tagName
    if (tagMatchesOppositeTagType) return true

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
  const tagToPullOut = inputTags.elements[tagIndexToPullOut]
  inputTags.elements.splice(tagIndexToPullOut, 1)

  const chamferLength = findKwArg('length', callExpr)
  if (!chamferLength) return new Error('no chamfer length')
  const tagDec = createTagDeclarator(findUniqueName(_node, 'seg', 2))
  const solid3dIdentifierUsedInOriginalChamfer = callExpr.unlabeled
  const solid = isPipeExpression ? null : solid3dIdentifierUsedInOriginalChamfer
  const newExpressionToInsert = createCallExpressionStdLibKw('chamfer', solid, [
    createLabeledArg('length', chamferLength),
    createLabeledArg('tags', createArrayExpression([tagToPullOut])),
    createLabeledArg('tag', tagDec),
  ])

  if (isPipeExpression) {
    pipeExpr.node.body.splice(pipeIndex, 0, newExpressionToInsert)
  } else {
    callExpr.unlabeled = null
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
  edgeCutMeta: EdgeCutInfo | null,
  wasmInstance: ModuleType
):
  | {
      modifiedAst: Node<Program>
      tag: string
    }
  | Error {
  if (expressionName === 'close') {
    return addTagKw()(tagInfo)
  }
  if (expressionName === 'chamfer' || expressionName === 'fillet') {
    if (edgeCutMeta === null) {
      return new Error(
        'Cannot add tag to edge cut because no edge cut was provided'
      )
    }
    return addTagToEdgeCut(tagInfo, edgeCutMeta, wasmInstance)
  }
  if (isTaggableSketchSegment(expressionName)) {
    return addTagKw()(tagInfo)
  }
  return new Error(`"${expressionName}" is not a sketch line helper`)
}
