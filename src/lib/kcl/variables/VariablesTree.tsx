import ReactJsonView from '@microlink/react-json-view'
import toast from 'react-hot-toast'
import { ActionButton } from '@src/components/ActionButton'
import Tooltip from '@src/components/Tooltip'
import type { VariableMap } from '@src/lang/wasm'
import { processMemory } from '@src/lib/kcl/variables/processMemory'
import type { ResolvedTheme } from '@src/lib/theme'
import { trap } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export function CopyVariablesButton({ variables }: { variables: VariableMap }) {
  function copyProgramMemoryToClipboard() {
    if (globalThis && 'navigator' in globalThis) {
      navigator.clipboard
        .writeText(JSON.stringify(variables))
        .then(() => toast.success('Program memory copied to clipboard.'))
        .catch((_e) =>
          trap(new Error('Failed to copy program memory to clipboard'))
        )
    }
  }

  return (
    <ActionButton
      Element="button"
      aria-label="Copy variables to clipboard"
      iconStart={{
        icon: 'clipboardPlus',
        iconClassName: '!text-current',
        bgClassName: 'bg-transparent',
      }}
      className="!p-0 !bg-transparent hover:text-primary border-transparent hover:border-primary !outline-none"
      onClick={copyProgramMemoryToClipboard}
    >
      <Tooltip position="bottom-right">Copy to clipboard</Tooltip>
    </ActionButton>
  )
}

export function VariablesTree({
  variables,
  wasm,
  theme,
  inSketch = false,
}: {
  variables: VariableMap
  wasm: ModuleType
  theme: ResolvedTheme
  inSketch?: boolean
}) {
  const memory = processMemory(variables, wasm)
  return (
    <div className="h-full relative">
      <div className="absolute inset-0 p-2 flex flex-col items-start">
        <div className="overflow-auto h-full w-full pb-12">
          <ReactJsonView
            src={memory}
            collapsed={1}
            collapseStringsAfterLength={60}
            enableClipboard={false}
            displayDataTypes={false}
            displayObjectSize={true}
            indentWidth={2}
            quotesOnKeys={false}
            sortKeys={true}
            name={false}
            theme={theme === 'light' ? 'rjv-default' : 'monokai'}
          />
        </div>
      </div>
      {inSketch && (
        <div
          className="absolute inset-0 bg-2/80 cursor-not-allowed"
          title="Variables won't update in sketch mode"
        />
      )}
    </div>
  )
}
