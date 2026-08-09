import ReactJsonView from '@microlink/react-json-view'
import toast from 'react-hot-toast'

import { ActionButton } from '@src/components/ActionButton'
import Loading from '@src/components/Loading'
import Tooltip from '@src/components/Tooltip'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import { useSingletons } from '@src/lib/boot'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { trap } from '@src/lib/trap'
import { Suspense, use } from 'react'
import { processMemory } from '@src/components/layout/areas/MemoryPane.utils'

export { processMemory }

export const MemoryPaneMenu = () => {
  const { kclManager } = useSingletons()
  const variables = kclManager.variablesSignal.value

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
    <>
      <ActionButton
        Element="button"
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
    </>
  )
}

export function MemoryPane(props: AreaTypeComponentProps) {
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
        Menu={MemoryPaneMenu}
        onClose={props.onClose}
      />
      <Suspense fallback={<Loading>Loading...</Loading>}>
        <MemoryPaneContents />
      </Suspense>
    </LayoutPanel>
  )
}

export const MemoryPaneContents = () => {
  const { kclManager } = useSingletons()
  const theme = useResolvedTheme()
  const variables = kclManager.variablesSignal.value
  const { state } = useModelingContext()
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const ProcessedMemory = processMemory(variables, wasmInstance)

  return (
    <div className="h-full relative">
      <div className="absolute inset-0 p-2 flex flex-col items-start">
        <div className="overflow-auto h-full w-full pb-12">
          <ReactJsonView
            src={ProcessedMemory}
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
      {state.matches('Sketch') && (
        <div
          className="absolute inset-0 dark:bg-chalkboard-90/80 bg-chalkboard-10/80 cursor-not-allowed"
          title="Variables won't update in sketch mode"
        ></div>
      )}
    </div>
  )
}
