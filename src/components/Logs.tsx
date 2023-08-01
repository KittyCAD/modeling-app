import ReactJson from 'react-json-view'
import { useEffect } from 'react'
import { useStore } from '../useStore'
import { PanelHeader } from './PanelHeader'

const ReactJsonTypeHack = ReactJson as any

export const Logs = ({ theme = 'light' }: { theme?: 'light' | 'dark' }) => {
  const { logs, resetLogs } = useStore(({ logs, resetLogs }) => ({
    logs,
    resetLogs,
  }))
  useEffect(() => {
    const element = document.querySelector('.console-tile')
    if (element) {
      element.scrollTop = element.scrollHeight - element.clientHeight
    }
  }, [logs])
  return (
    <div className="w-full h-full">
      <PanelHeader title="Logs" />
      <div className="relative w-full">
        <div className="absolute inset-0 flex flex-col">
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
    </div>
  )
}

export const KCLErrors = ({
  theme = 'light',
}: {
  theme?: 'light' | 'dark'
}) => {
  const { kclErrors } = useStore(({ kclErrors }) => ({
    kclErrors,
  }))
  useEffect(() => {
    const element = document.querySelector('.console-tile')
    if (element) {
      element.scrollTop = element.scrollHeight - element.clientHeight
    }
  }, [kclErrors])
  return (
    <div className="h-full w-full">
      <PanelHeader title="KCL Errors" />
      <div className="h-full relative">
        <div className="absolute inset-0 flex flex-col">
          <ReactJsonTypeHack
            src={kclErrors}
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
    </div>
  )
}
