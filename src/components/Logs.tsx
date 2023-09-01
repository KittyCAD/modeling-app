import ReactJson from 'react-json-view'
import { useEffect } from 'react'
import { useStore } from '../useStore'
import { CollapsiblePanel, CollapsiblePanelProps } from './CollapsiblePanel'
import { Themes } from '../lib/theme'

const ReactJsonTypeHack = ReactJson as any

interface LogPanelProps extends CollapsiblePanelProps {
  theme?: Exclude<Themes, Themes.System>
}

export const Logs = ({ theme = Themes.Light, ...props }: LogPanelProps) => {
  const { logs } = useStore(({ logs }) => ({
    logs,
  }))
  useEffect(() => {
    const element = document.querySelector('.console-tile')
    if (element) {
      element.scrollTop = element.scrollHeight - element.clientHeight
    }
  }, [logs])
  return (
    <CollapsiblePanel {...props}>
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
    </CollapsiblePanel>
  )
}

export const KCLErrors = ({
  theme = Themes.Light,
  ...props
}: LogPanelProps) => {
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
    <CollapsiblePanel {...props}>
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
    </CollapsiblePanel>
  )
}

export const LSPMessages = ({
  theme = Themes.Light,
  ...props
}: LogPanelProps) => {
  const { lspMessages } = useStore(({ lspMessages }) => ({
    lspMessages,
  }))
  useEffect(() => {
    const element = document.querySelector('.console-tile')
    if (element) {
      element.scrollTop = element.scrollHeight - element.clientHeight
    }
  }, [lspMessages])

  const lspMessagesStr = lspMessages.map((msg) => msg).join('\n')
  return (
    <CollapsiblePanel {...props}>
      <div className="h-full relative">
        <div className="absolute inset-0 flex flex-col">
          <pre style={{ fontSize: '10px' }}>{lspMessagesStr}</pre>
        </div>
      </div>
    </CollapsiblePanel>
  )
}
