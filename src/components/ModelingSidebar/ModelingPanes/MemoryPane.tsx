import toast from 'react-hot-toast'
import ReactJson from 'react-json-view'
import { useMemo } from 'react'
import {
  Path,
  ExtrudeSurface,
  sketchFromKclValueOptional,
  VariableMap,
} from 'lang/wasm'
import { useKclContext } from 'lang/KclProvider'
import { useResolvedTheme } from 'hooks/useResolvedTheme'
import { ActionButton } from 'components/ActionButton'
import { Reason, trap } from 'lib/trap'
import Tooltip from 'components/Tooltip'
import { useModelingContext } from 'hooks/useModelingContext'

export const MemoryPaneMenu = () => {
  const { variables } = useKclContext()

  function copyProgramMemoryToClipboard() {
    if (globalThis && 'navigator' in globalThis) {
      navigator.clipboard
        .writeText(JSON.stringify(variables))
        .then(() => toast.success('Program memory copied to clipboard'))
        .catch((e) =>
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
        <Tooltip position="bottom-right" delay={750}>
          Copy to clipboard
        </Tooltip>
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
          <ReactJson
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

export const processMemory = (variables: VariableMap) => {
  const processedMemory: any = {}
  for (const [key, val] of Object.entries(variables)) {
    if (val === undefined) continue
    if (
      val.type === 'Sketch' ||
      // @ts-ignore
      val.type !== 'Function'
    ) {
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
      } else {
        processedMemory[key] = val.value
      }
      //@ts-ignore
    } else if (val.type === 'Function') {
      processedMemory[key] = `__function__`
    }
  }
  return processedMemory
}
