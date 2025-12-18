import type { KclManager } from '@src/lang/KclManager'
import { isToolTip } from '@src/lang/langHelpers'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getTransformInfos } from '@src/lang/std/sketchcombos'
import type { TransformInfo } from '@src/lang/std/stdTypes'
import type { Expr } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export function angleLengthInfo({
  selectionRanges,
  angleOrLength = 'setLength',
  kclManager,
  wasmInstance,
}: {
  selectionRanges: Selections
  angleOrLength?: 'setLength' | 'setAngle'
  kclManager: KclManager
  wasmInstance: ModuleType
}):
  | {
      transforms: TransformInfo[]
      enabled: boolean
    }
  | Error {
  const nodes = selectionRanges.graphSelections.map(({ codeRef }) =>
    getNodeFromPath<Expr>(kclManager.ast, codeRef.pathToNode, [
      'CallExpressionKw',
    ])
  )
  const _err1 = nodes.find(err)
  if (_err1 instanceof Error) return _err1

  const isAllTooltips = nodes.every((meta) => {
    if (err(meta)) return false
    return (
      meta.node?.type === 'CallExpressionKw' &&
      isToolTip(meta.node.callee.name.name)
    )
  })

  const transforms = getTransformInfos(
    selectionRanges,
    kclManager.ast,
    angleOrLength,
    wasmInstance
  )
  const enabled =
    selectionRanges.graphSelections.length <= 1 &&
    isAllTooltips &&
    transforms.every(Boolean)
  return { enabled, transforms }
}
