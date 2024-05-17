import { useResolvedTheme } from 'hooks/useResolvedTheme'
import { engineCommandManager } from 'lib/singletons'
import ReactJson from 'react-json-view'

export const SceneTreePane = () => {
  const theme = useResolvedTheme()
  const { artifactMap } = engineCommandManager
  return (
    <div className="h-full relative">
      <div className="absolute inset-0 p-2 flex flex-col items-start">
        <div className="overflow-auto h-full w-full pb-12">
          <ReactJson
            src={artifactMap}
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
