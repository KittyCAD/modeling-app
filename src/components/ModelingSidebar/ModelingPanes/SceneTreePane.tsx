import ReactJson from 'react-json-view'
import { useMemo } from 'react'
import { ProgramMemory, Path, ExtrudeSurface } from 'lang/wasm'
import { useKclContext } from 'lang/KclProvider'
import { useResolvedTheme } from 'hooks/useResolvedTheme'

export const SceneTreePane = () => {
  const theme = useResolvedTheme()
  const { programMemory } = useKclContext()
  const ProcessedMemory = useMemo(
    () => processMemory(programMemory),
    [programMemory]
  )
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
            name={false}
            theme={theme === 'light' ? 'rjv-default' : 'monokai'}
          />
        </div>
      </div>
    </div>
  )
}

export const processMemory = (programMemory: ProgramMemory) => {
  const processedMemory: any = {}
  Object.keys(programMemory?.root || {}).forEach((key) => {
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
