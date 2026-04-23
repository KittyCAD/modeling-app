import type {
  ApiObject,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import type RustContext from '@src/lib/rustContext'
import {
  getConstraintToolPreparedApply,
  type ConstraintToolPreparedApply,
} from '@src/machines/sketchSolve/tools/constraintToolHelpers'
import type { ConstraintToolName } from '@src/machines/sketchSolve/tools/constraintToolModel'
import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'

type ConstraintMutationResult = Awaited<
  ReturnType<RustContext['addConstraint']>
>

export type ConstraintToolbarActionResult =
  | {
      type: 'equipped'
      toolName: ConstraintToolName
    }
  | {
      type: 'applied'
      toolName: ConstraintToolName
      preparedApply: ConstraintToolPreparedApply
      result: ConstraintMutationResult | undefined
    }

export async function applyOrEquipConstraintToolFromToolbar({
  toolName,
  selectedIds,
  objects,
  defaultLengthUnit,
  rustContext,
  sketchId,
  settings,
  equipConstraintTool,
}: {
  toolName: ConstraintToolName
  selectedIds: readonly SketchSolveSelectionId[]
  objects: readonly ApiObject[]
  defaultLengthUnit: NumericSuffix
  rustContext: Pick<RustContext, 'addConstraint'>
  sketchId: number
  settings: Parameters<RustContext['addConstraint']>[3]
  equipConstraintTool: (toolName: ConstraintToolName) => void
}): Promise<ConstraintToolbarActionResult> {
  const preparedApply = getConstraintToolPreparedApply(
    toolName,
    selectedIds,
    objects,
    { defaultLengthUnit }
  )

  if (!preparedApply) {
    equipConstraintTool(toolName)
    return {
      type: 'equipped',
      toolName,
    }
  }

  let result:
    | {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
      }
    | undefined

  for (const [index, payload] of preparedApply.payloads.entries()) {
    result = await rustContext.addConstraint(
      0,
      sketchId,
      payload,
      settings,
      index === preparedApply.payloads.length - 1
    )
  }

  return {
    type: 'applied',
    toolName,
    preparedApply,
    result,
  }
}
