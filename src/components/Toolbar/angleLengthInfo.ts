import { toolTips } from '@src/lang/langHelpers'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getTransformInfos } from '@src/lang/std/sketchcombos'
import { TransformInfo } from '@src/lang/std/stdTypes'
import { Expr } from '@src/lang/wasm'
import { Selections } from '@src/lib/selections'
import { kclManager } from '@src/lib/singletons'
import { err } from '@src/lib/trap'

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
