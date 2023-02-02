import ReactJson from 'react-json-view'
import { PanelHeader } from './PanelHeader'
import { useStore } from '../useStore'
import { useMemo } from 'react'
import { ProgramMemory } from '../lang/executor'

export const MemoryPanel = () => {
  const { programMemory } = useStore((s) => ({
    programMemory: s.programMemory,
  }))
  const ProcessedMemory = useMemo(
    () => processMemory(programMemory),
    [programMemory]
  )
  return (
    <div className="h-full">
      <PanelHeader title="Variables" />
      <div className="h-full relative">
        <div className="absolute inset-0 flex flex-col items-start">
          <div className=" overflow-auto h-full console-tile w-full">
            <ReactJson
              src={ProcessedMemory}
              collapsed={1}
              collapseStringsAfterLength={60}
              enableClipboard={false}
              displayDataTypes={false}
              displayObjectSize={true}
              name={false}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const processMemory = (programMemory: ProgramMemory) => {
  const processedMemory: any = {}
  Object.keys(programMemory.root).forEach((key) => {
    const val = programMemory.root[key]
    if (typeof val.value !== 'function') {
      if (val.type === 'sketchGroup' || val.type === 'extrudeGroup') {
        processedMemory[key] = val.value.map(({ __geoMeta, ...rest }) => {
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
