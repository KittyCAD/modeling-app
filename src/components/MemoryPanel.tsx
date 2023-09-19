import ReactJson from 'react-json-view'
import { CollapsiblePanel, CollapsiblePanelProps } from './CollapsiblePanel'
import { useStore } from '../useStore'
import { useMemo } from 'react'
import { ProgramMemory, Path, ExtrudeSurface } from '../lang/executor'
import { Themes } from '../lib/theme'

interface MemoryPanelProps extends CollapsiblePanelProps {
  theme?: Exclude<Themes, Themes.System>
}

export const MemoryPanel = ({
  theme = Themes.Light,
  ...props
}: MemoryPanelProps) => {
  const { programMemory } = useStore((s) => ({
    programMemory: s.programMemory,
  }))
  const ProcessedMemory = useMemo(
    () => processMemory(programMemory),
    [programMemory]
  )
  return (
    <CollapsiblePanel {...props}>
      <div className="h-full relative">
        <div className="absolute inset-0 flex flex-col items-start">
          <div
            className="overflow-y-auto h-full console-tile w-full"
            style={{ marginBottom: 36 }}
          >
            {/* 36px is the height of PanelHeader */}
            <ReactJson
              src={ProcessedMemory}
              collapsed={1}
              collapseStringsAfterLength={60}
              enableClipboard={false}
              displayDataTypes={false}
              displayObjectSize={true}
              indentWidth={2}
              quotesOnKeys={false}
              name={false}
              theme={theme === 'light' ? 'rjv-default' : 'monokai'}
            />
          </div>
        </div>
      </div>
    </CollapsiblePanel>
  )
}

export const processMemory = (programMemory: ProgramMemory) => {
  const processedMemory: any = {}
  Object.keys(programMemory.root).forEach((key) => {
    const val = programMemory.root[key]
    if (typeof val.value !== 'function') {
      if (val.type === 'SketchGroup') {
        processedMemory[key] = val.value.map(({ __geoMeta, ...rest }: Path) => {
          return rest
        })
      } else if (val.type === 'ExtrudeGroup') {
        processedMemory[key] = val.value.map(({ ...rest }: ExtrudeSurface) => {
          return rest
        })
      } else {
        processedMemory[key] = val.value
      }
    } else if (key !== 'log') {
      processedMemory[key] = '__function__'
    }
  })
  return processedMemory
}
