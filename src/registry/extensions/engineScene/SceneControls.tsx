import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
import { Suspense, createElement, lazy } from 'react'
import { sceneControlsViewExtensionsValueSpec } from './viewExtensions'

const Gizmo = lazy(async () => {
  const { default: Gizmo } = await import('@src/components/gizmo/Gizmo')
  return { default: Gizmo }
})

export function EngineSceneControls() {
  useSignals()
  const { registry } = useApp()
  const sceneControlsViewExtensions = registry.signal(
    sceneControlsViewExtensionsValueSpec
  ).value

  return (
    <div className="absolute bottom-2 right-2 z-10 flex flex-row-reverse items-end gap-3 pointer-events-none">
      <Suspense fallback={null}>{createElement(Gizmo)}</Suspense>
      {sceneControlsViewExtensions.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </div>
  )
}
