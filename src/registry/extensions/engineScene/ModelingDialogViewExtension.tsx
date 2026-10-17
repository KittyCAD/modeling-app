import { lazy, Suspense, useRef } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import { useDialogReset } from '@src/components/ModelingDialog/useDialogReset'
import { useApp } from '@src/lib/boot'
import { projectSession } from '@src/registry/contracts/projectSession'
import { isModelingDialogCommand } from '@src/lib/commandUtils'
import { commandScopeService } from '@src/registry/contracts/commands'
import type { EngineSceneViewExtensionProps } from '@src/registry/contracts/engineScene'

const ModelingDialog = lazy(
  () => import('@src/components/ModelingDialog/ModelingDialog')
)

export function ModelingDialogViewExtension({
  modelingState,
  modelingSend,
}: EngineSceneViewExtensionProps) {
  useSignals()
  const containerRef = useRef<HTMLDivElement>(null)
  const { commands, settings, layout, wasmPromise, registry } = useApp()
  const state = commands.useState()
  const resetting = useDialogReset(commands.actor)
  if (
    resetting ||
    state.matches('Closed') ||
    !isModelingDialogCommand(state.context.selectedCommand)
  )
    return null
  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute top-20 bottom-2 inset-x-2 flex min-h-0 items-start justify-end"
    >
      <Suspense fallback={null}>
        <ModelingDialog
          containerRef={containerRef}
          kclManager={modelingState.context.kclManager}
          commands={commands}
          settings={settings}
          layout={layout}
          codeChangesPreview={
            registry.get(projectSession).project.value?.codeChangesPreview
          }
          wasmPromise={wasmPromise}
          commandScopes={registry.optional(commandScopeService)}
          selectionRanges={modelingState.context.selectionRanges}
          modelingSend={modelingSend}
        />
      </Suspense>
    </div>
  )
}
