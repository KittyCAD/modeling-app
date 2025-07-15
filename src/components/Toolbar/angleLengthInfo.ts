import { toolTips } from '@src/lang/langHelpers'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getTransformInfos } from '@src/lang/std/sketchcombos'
import type { TransformInfo } from '@src/lang/std/stdTypes'
import type { Expr, Program } from '@src/lang/wasm'
import type { Selections } from '@src/lib/selections'
import { err } from '@src/lib/trap'
import type { Node } from '@rust/kcl-lib/bindings/Node'

export function angleLengthInfo({
  selectionRanges,
  angleOrLength = 'setLength',
  ast,
}: {
  selectionRanges: Selections
  angleOrLength?: 'setLength' | 'setAngle'
  ast: Node<Program>
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
    }
  | Error {
  const nodes = selectionRanges.graphSelections.map(({ codeRef }) =>
    getNodeFromPath<Expr>(ast, codeRef.pathToNode, ['CallExpressionKw'])
  )
  const _err1 = nodes.find(err)
  if (_err1 instanceof Error) return _err1

  const isAllTooltips = nodes.every((meta) => {
    if (err(meta)) return false
    return (
      meta.node?.type === 'CallExpressionKw' &&
      toolTips.includes(meta.node.callee.name.name as any)
    )
  })

  const transforms = getTransformInfos(selectionRanges, ast, angleOrLength)
  const enabled =
    selectionRanges.graphSelections.length <= 1 &&
    isAllTooltips &&
    transforms.every(Boolean)
  return { enabled, transforms }
}
