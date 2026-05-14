import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
import { viewExtensionsValueSpec } from './viewExtensions'

export function EngineSceneViewExtensions() {
  useSignals()
  const { registry } = useApp()
  const viewExtensions = registry.signal(viewExtensionsValueSpec).value

  return (
    <>
      {viewExtensions.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </>
  )
}
