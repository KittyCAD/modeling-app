import ReactJsonView from '@microlink/react-json-view'
import { useMemo } from 'react'
import toast from 'react-hot-toast'

import type { ExtrudeSurface } from '@rust/kcl-lib/bindings/ExtrudeSurface'
import type { Path } from '@rust/kcl-lib/bindings/Path'

import { ActionButton } from '@src/components/ActionButton'
import Tooltip from '@src/components/Tooltip'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import { useKclContext } from '@src/lang/KclProvider'
import type { VariableMap } from '@src/lang/wasm'
import { humanDisplayNumber, sketchFromKclValueOptional } from '@src/lang/wasm'
import { Reason, trap } from '@src/lib/trap'

export const MemoryPaneMenu = () => {
  const { variables } = useKclContext()

  function copyProgramMemoryToClipboard() {
    if (globalThis && 'navigator' in globalThis) {
      navigator.clipboard
        .writeText(JSON.stringify(variables))
        .then(() => toast.success('Program memory copied to clipboard'))
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

export const MemoryPane = () => {
  const theme = useResolvedTheme()
  const { variables } = useKclContext()
  const { state } = useModelingContext()
  const ProcessedMemory = useMemo(() => processMemory(variables), [variables])
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

export function processMemory(variables: VariableMap) {
  const processedMemory: Record<
    string,
    string | number | boolean | object | undefined
  > = {}
  for (const [key, val] of Object.entries(variables)) {
    if (val === undefined) continue
    const sk = sketchFromKclValueOptional(val, key)
    if (val.type === 'Solid') {
      processedMemory[key] = val.value.value.map(
        ({ ...rest }: ExtrudeSurface) => {
          return rest
        }
      )
    } else if (!(sk instanceof Reason)) {
      processedMemory[key] = sk.paths.map(({ __geoMeta, ...rest }: Path) => {
        return rest
      })
    } else if (val.type === 'Function') {
      processedMemory[key] = '__function__'
    } else if (val.type === 'Number') {
      processedMemory[key] = humanDisplayNumber(val.value, val.ty)
    } else if (val.type === 'SketchVar') {
      const sketchVar = val.value
      processedMemory[key] =
        `var ${humanDisplayNumber(sketchVar.initialValue, sketchVar.ty)}`
    } else {
      processedMemory[key] = val.value
    }
  }
  return processedMemory
}
