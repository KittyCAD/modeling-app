import { toolTips } from 'lang/langHelpers'
import { Program, Expr, VariableDeclarator } from '../../lang/wasm'
import { getNodeFromPath } from '../../lang/queryAst'
import { isSketchVariablesLinked } from '../../lang/std/sketchConstraints'
import {
  transformSecondarySketchLinesTagFirst,
  getTransformInfos,
  PathToNodeMap,
  isExprBinaryPart,
} from '../../lang/std/sketchcombos'
import { TransformInfo } from 'lang/std/stdTypes'
import { GetInfoModal, createInfoModal } from '../SetHorVertDistanceModal'
import { createLiteral, createVariableDeclaration } from '../../lang/modifyAst'
import { removeDoubleNegatives } from '../AvailableVarsHelpers'
import { kclManager } from 'lib/singletons'
import { Selections } from 'lib/selections'
import { cleanErrs, err } from 'lib/trap'
import { Node } from 'wasm-lib/kcl/bindings/Node'

const getModalInfo = createInfoModal(GetInfoModal)

export function horzVertDistanceInfo({
  selectionRanges,
  constraint,
}: {
  selectionRanges: Selections
  constraint: 'setHorzDistance' | 'setVertDistance'
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
    }
  | Error {
  const _nodes = selectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<Expr>(kclManager.ast, codeRef.pathToNode)
    if (err(tmp)) return tmp
    return tmp.node
  })
  const [hasErr, , nodesWErrs] = cleanErrs(_nodes)

  if (hasErr) return nodesWErrs[0]
  const nodes = _nodes as Expr[]

  const _varDecs = selectionRanges.graphSelections.map(({ codeRef }) => {
    const tmp = getNodeFromPath<VariableDeclarator>(
      kclManager.ast,
      codeRef.pathToNode,
      'VariableDeclarator'
    )
    if (err(tmp)) return tmp
    return tmp.node
  })
  const _err2 = _varDecs.find(err)
  if (err(_err2)) return _err2
  const varDecs = _varDecs as VariableDeclarator[]

  const primaryLine = varDecs[0]
  const secondaryVarDecs = varDecs.slice(1)
  const isOthersLinkedToPrimary = secondaryVarDecs.every((secondary) =>
    isSketchVariablesLinked(secondary, primaryLine, kclManager.ast)
  )
  const isAllTooltips = nodes.every(
    (node) =>
      (node?.type === 'CallExpression' || node?.type === 'CallExpressionKw') &&
      [
        ...toolTips,
        'startSketchAt', // TODO probably a better place for this to live
      ].includes(node.callee.name as any)
  )

  const theTransforms = getTransformInfos(
    {
      ...selectionRanges,
      graphSelections: selectionRanges.graphSelections.slice(1),
    },
    kclManager.ast,
    constraint
  )
  const _enableEqual =
    secondaryVarDecs.length === 1 &&
    isAllTooltips &&
    isOthersLinkedToPrimary &&
    theTransforms.every(Boolean)
  return { enabled: _enableEqual, transforms: theTransforms }
}

export async function applyConstraintHorzVertDistance({
  selectionRanges,
  constraint,
}: {
  selectionRanges: Selections
  constraint: 'setHorzDistance' | 'setVertDistance'
}): Promise<{
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
  exprInsertIndex: number
}> {
  const info = horzVertDistanceInfo({
    selectionRanges: selectionRanges,
    constraint,
  })
  if (err(info)) return Promise.reject(info)
  const transformInfos = info.transforms
  const transformed = transformSecondarySketchLinesTagFirst({
    ast: structuredClone(kclManager.ast),
    selectionRanges,
    transformInfos,
    memVars: kclManager.variables,
  })
  if (err(transformed)) return Promise.reject(transformed)
  const { modifiedAst, tagInfo, valueUsedInTransform, pathToNodeMap } =
    transformed
  const {
    segName,
    value,
    valueNode,
    variableName,
    newVariableInsertIndex,
    sign,
  } = await getModalInfo({
    segName: tagInfo?.tag,
    isSegNameEditable: !tagInfo?.isTagExisting,
    value: valueUsedInTransform,
    initialVariableName: constraint === 'setHorzDistance' ? 'xDis' : 'yDis',
  } as any)
  if (
    !variableName &&
    segName === tagInfo?.tag &&
    Number(value) === valueUsedInTransform
  ) {
    return {
      modifiedAst,
      pathToNodeMap,
      exprInsertIndex: -1,
    }
  } else {
    if (!isExprBinaryPart(valueNode))
      return Promise.reject('Invalid valueNode, is not a BinaryPart')
    let finalValue = removeDoubleNegatives(valueNode, sign, variableName)
    // transform again but forcing certain values
    const transformed = transformSecondarySketchLinesTagFirst({
      ast: kclManager.ast,
      selectionRanges,
      transformInfos,
      memVars: kclManager.variables,
      forceSegName: segName,
      forceValueUsedInTransform: finalValue,
    })

    if (err(transformed)) return Promise.reject(transformed)
    const { modifiedAst: _modifiedAst, pathToNodeMap } = transformed
    let exprInsertIndex = -1
    if (variableName) {
      const newBody = [..._modifiedAst.body]
      newBody.splice(
        newVariableInsertIndex,
        0,
        createVariableDeclaration(variableName, valueNode)
      )
      _modifiedAst.body = newBody
      Object.values(pathToNodeMap).forEach((pathToNode) => {
        const index = pathToNode.findIndex((a) => a[0] === 'body') + 1
        pathToNode[index][0] = Number(pathToNode[index][0]) + 1
      })
      exprInsertIndex = newVariableInsertIndex
    }
    return {
      modifiedAst: _modifiedAst,
      pathToNodeMap,
      exprInsertIndex,
    }
  }
}

export function applyConstraintHorzVertAlign({
  selectionRanges,
  constraint,
}: {
  selectionRanges: Selections
  constraint: 'setHorzDistance' | 'setVertDistance'
}):
  | {
      modifiedAst: Node<Program>
      pathToNodeMap: PathToNodeMap
    }
  | Error {
  const info = horzVertDistanceInfo({
    selectionRanges,
    constraint,
  })
  if (err(info)) return info
  const transformInfos = info.transforms
  let finalValue = createLiteral(0)
  const retval = transformSecondarySketchLinesTagFirst({
    ast: kclManager.ast,
    selectionRanges,
    transformInfos,
    memVars: kclManager.variables,
    forceValueUsedInTransform: finalValue,
  })
  if (err(retval)) return retval
  const { modifiedAst, pathToNodeMap } = retval
  return {
    modifiedAst: modifiedAst,
    pathToNodeMap,
  }
}
