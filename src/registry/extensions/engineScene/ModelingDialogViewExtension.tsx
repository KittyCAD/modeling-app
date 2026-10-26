import { lazy, Suspense, useRef } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
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
  const { commands, settings, wasmPromise, registry } = useApp()
  const session = commands.dialogSession.value
  if (!session) return null
  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute top-20 bottom-2 inset-x-2 flex min-h-0 items-start justify-end"
    >
      <Suspense fallback={null}>
        <ModelingDialog
          key={session.id}
          session={session}
          containerRef={containerRef}
          kclManager={modelingState.context.kclManager}
          commands={commands}
          settings={settings}
          wasmPromise={wasmPromise}
          commandScopes={registry.optional(commandScopeService)}
          selectionRanges={modelingState.context.selectionRanges}
          modelingSend={modelingSend}
        />
      </Suspense>
    </div>
  )
}
