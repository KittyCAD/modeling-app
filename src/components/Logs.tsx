import ReactJson from 'react-json-view'
import { useEffect } from 'react'
import { useStore } from '../useStore'
import { PanelHeader } from './PanelHeader'

const ReactJsonTypeHack = ReactJson as any

export const Logs = () => {
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
    <div>
      <PanelHeader title="Logs" />
      <div className="h-full relative">
        <div className="absolute inset-0 flex flex-col items-start">
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
          />
        </div>
      </div>
    </div>
  )
}

export const KCLErrors = () => {
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
    <div>
      <PanelHeader title="KCL Errors" />
      <div className="h-full relative">
        <div className="absolute inset-0 flex flex-col items-start">
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
          />
        </div>
      </div>
    </div>
  )
}
