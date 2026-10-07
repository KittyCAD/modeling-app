import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
import type { EngineSceneExtensionContext } from '@src/registry/contracts/engineScene'
import { modesService } from '@src/registry/contracts/modes'
import { BuiltInModeScene } from '@src/registry/extensions/modes/builtinModes'
import { Suspense } from 'react'

/** The engine stream stays mounted while modes supply their client scene. */
export function ModeScene(props: EngineSceneExtensionContext) {
  useSignals()
  const { registry } = useApp()
  const Scene =
    registry.get(modesService).activeMode.value?.Scene ?? BuiltInModeScene

  return (
    <Suspense fallback={null}>
      <Scene {...props} />
    </Suspense>
  )
}
