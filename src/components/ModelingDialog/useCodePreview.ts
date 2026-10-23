import { useEffect, useState } from 'react'
import {
  createModelingCodePreview,
  type ModelingPreviewDraft,
} from '@src/components/ModelingDialog/codePreview'
import type { KclManager } from '@src/lang/KclManager'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import type { CodeChangesPreviewService } from '@src/registry/contracts/codeChangesPreview'

export function useCodePreview({
  context,
  values,
  incomplete,
  kclManager,
  preview,
  commandBar,
}: ModelingPreviewDraft & {
  kclManager: KclManager
  preview: CodeChangesPreviewService | undefined
  commandBar: CommandBarActorType
}) {
  const [controller, setController] =
    useState<ReturnType<typeof createModelingCodePreview>>()

  useEffect(() => {
    if (!preview) return
    const next = createModelingCodePreview({ kclManager, preview, commandBar })
    setController(next)
    return () => next.dispose()
  }, [kclManager, preview, commandBar])

  useEffect(() => {
    controller?.update({ context, values, incomplete })
  }, [controller, context, values, incomplete])

  return {
    open: controller?.open.value ?? false,
    available: controller?.available.value ?? false,
    toggle: () => controller?.toggle(),
  }
}
