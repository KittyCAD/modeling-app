import { useSignals } from '@preact/signals-react/runtime'
import Loading from '@src/components/Loading'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import { useSingletons } from '@src/lib/boot'
import {
  CopyVariablesButton,
  VariablesTree,
} from '@src/lib/kcl/variables/VariablesTree'
import type { VariableMap } from '@src/lang/wasm'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import type { ResolvedTheme } from '@src/lib/theme'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { Suspense, use } from 'react'

export function MemoryPane(props: AreaTypeComponentProps) {
  useSignals()
  const { kclManager } = useSingletons()
  const variables = kclManager.variablesSignal.value
  const theme = useResolvedTheme()
  const { state } = useModelingContext()
  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="make-variable"
        title={props.layout.label}
        Menu={<CopyVariablesButton variables={variables} />}
        onClose={props.onClose}
      />
      <Suspense fallback={<Loading>Loading...</Loading>}>
        <LegacyVariablesTree
          variables={variables}
          wasm={kclManager.wasmInstancePromise}
          theme={theme}
          inSketch={state.matches('Sketch')}
        />
      </Suspense>
    </LayoutPanel>
  )
}

function LegacyVariablesTree({
  wasm,
  ...props
}: {
  variables: VariableMap
  wasm: Promise<ModuleType>
  theme: ResolvedTheme
  inSketch: boolean
}) {
  return <VariablesTree {...props} wasm={use(wasm)} />
}
