import { useEffect } from 'react'
import { useStore } from '../useStore'
import { PanelHeader } from './PanelHeader'

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
          <button onClick={resetLogs}>reset</button>
          <div className=" overflow-auto h-full console-tile w-full">
            {logs.map((msg, index) => {
              return (
                <pre className="text-xs pl-2 text-sky-600" key={index}>
                  <code style={{ fontFamily: 'monospace' }} key={index}>
                    <span className="text-gray-400">{'- '}</span>
                    {String(msg)}
                  </code>
                </pre>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
