import { toolTips } from 'lang/langHelpers'
import { Selections } from 'lib/selections'
import { getNodeFromPath } from '../../lang/queryAst'
import { getTransformInfos } from '../../lang/std/sketchcombos'
import { TransformInfo } from 'lang/std/stdTypes'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import { Expr } from 'lang/wasm'

export function angleLengthInfo({
  selectionRanges,
  angleOrLength = 'setLength',
}: {
  selectionRanges: Selections
  angleOrLength?: 'setLength' | 'setAngle'
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
    }
  | Error {
  const nodes = selectionRanges.graphSelections.map(({ codeRef }) =>
    getNodeFromPath<Expr>(kclManager.ast, codeRef.pathToNode, [
      'CallExpression',
      'CallExpressionKw',
    ])
  )
  const _err1 = nodes.find(err)
  if (_err1 instanceof Error) return _err1

  const isAllTooltips = nodes.every((meta) => {
    if (err(meta)) return false
    return (
      (meta.node?.type === 'CallExpressionKw' ||
        meta.node?.type === 'CallExpression') &&
      toolTips.includes(meta.node.callee.name.name as any)
    )
  })

  const transforms = getTransformInfos(
    selectionRanges,
    kclManager.ast,
    angleOrLength
  )
  const enabled =
    selectionRanges.graphSelections.length <= 1 &&
    isAllTooltips &&
    transforms.every(Boolean)
  console.log(
    'enabled',
    enabled,
    selectionRanges.graphSelections.length,
    isAllTooltips,
    transforms.every(Boolean)
  )
  return { enabled, transforms }
}
