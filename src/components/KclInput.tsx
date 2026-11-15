import { useSignals } from '@preact/signals-react/runtime'
import { use } from 'react'
import { useApp, useSingletons } from '@src/lib/boot'
import { KclInputView, type KclInputProps } from '@src/components/KclInputView'

export function KclInput(props: KclInputProps) {
  useSignals()
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const wasm = use(kclManager.rustContext.wasmInstancePromise)
  return (
    <KclInputView
      {...props}
      host={{
        settings: settings.useSettings(),
        wasm,
        variables: kclManager.variablesSignal.value,
      }}
    />
  )
}
