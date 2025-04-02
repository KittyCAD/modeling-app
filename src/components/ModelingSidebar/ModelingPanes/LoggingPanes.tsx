import ReactJson from 'react-json-view'

import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import { useKclContext } from '@src/lang/KclProvider'

const ReactJsonTypeHack = ReactJson as any

export const LogsPane = () => {
  const theme = useResolvedTheme()
  const { logs } = useKclContext()
  return (
    <div className="overflow-hidden">
      <div className="absolute inset-0 p-2 flex flex-col overflow-auto">
        <ReactJsonTypeHack
          src={logs}
          collapsed={1}
          collapseStringsAfterLength={60}
          enableClipboard={false}
          displayArrayKey={false}
          displayDataTypes={false}
          displayObjectSize={true}
          indentWidth={2}
          quotesOnKeys={false}
          name={false}
          theme={theme === 'light' ? 'rjv-default' : 'monokai'}
        />
      </div>
    </div>
  )
}
