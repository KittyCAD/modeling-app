import ReactJson from 'react-json-view'
import { useEffect } from 'react'
import { CollapsiblePanel, CollapsiblePanelProps } from './CollapsiblePanel'
import { Themes } from '../lib/theme'
import { kclManager } from 'lib/singletons'

const ReactJsonTypeHack = ReactJson as any

interface LogPanelProps extends CollapsiblePanelProps {
  theme?: Exclude<Themes, Themes.System>
}

export const Logs = ({ theme = Themes.Light, ...props }: LogPanelProps) => {
  useEffect(() => {
    const element = document.querySelector('.console-tile')
    if (element) {
      element.scrollTop = element.scrollHeight - element.clientHeight
    }
  }, [kclManager.logs])
  return (
    <CollapsiblePanel {...props}>
      <div className="relative w-full">
        <div className="absolute inset-0 flex flex-col">
          <ReactJsonTypeHack
            src={kclManager.logs}
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
  useEffect(() => {
    const element = document.querySelector('.console-tile')
    if (element) {
      element.scrollTop = element.scrollHeight - element.clientHeight
    }
  }, [kclManager.kclErrors])
  return (
    <CollapsiblePanel {...props}>
      <div className="h-full relative">
        <div className="absolute inset-0 flex flex-col">
          <ReactJsonTypeHack
            src={kclManager.kclErrors}
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
