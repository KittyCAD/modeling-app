import type { ReadonlySignal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { LayoutPanelHeader } from '@src/components/layout/Panel'
import Loading from '@src/components/Loading'
import type { VariableMap } from '@src/lang/wasm'
import {
  CopyVariablesButton,
  VariablesTree,
} from '@src/lib/kcl/variables/VariablesTree'
import type { ResolvedTheme } from '@src/lib/theme'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export type VariablesState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'ready'; variables: VariableMap; wasm: ModuleType }

export function VariablesEditorView({
  state,
  readTheme,
}: {
  state: ReadonlySignal<VariablesState>
  readTheme: () => ResolvedTheme
}) {
  useSignals()
  const result = state.value
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <LayoutPanelHeader
        id="kcl-variables"
        icon="make-variable"
        title="Variables"
        Menu={
          result.type === 'ready' && (
            <CopyVariablesButton variables={result.variables} />
          )
        }
      />
      <div className="min-h-0 flex-1">
        {result.type === 'loading' ? (
          <Loading>Evaluating variables...</Loading>
        ) : result.type === 'error' ? (
          <p className="p-3 text-sm" role="alert">
            {result.message}
          </p>
        ) : (
          <VariablesTree
            variables={result.variables}
            wasm={result.wasm}
            theme={readTheme()}
          />
        )}
      </div>
    </div>
  )
}
