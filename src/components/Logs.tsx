import ReactJson from 'react-json-view'
import { useEffect } from 'react'
import { useStore } from '../useStore'
import { CollapsiblePanel, CollapsiblePanelProps } from './CollapsiblePanel'
import { Themes } from '../lib/theme'
import { useKclContext } from 'lang/KclSinglton'

const ReactJsonTypeHack = ReactJson as any

interface LogPanelProps extends CollapsiblePanelProps {
  theme?: Exclude<Themes, Themes.System>
}

export const Logs = ({ theme = Themes.Light, ...props }: LogPanelProps) => {
  const { logs } = useKclContext()
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
  const { errors } = useKclContext()
  useEffect(() => {
    const element = document.querySelector('.console-tile')
    if (element) {
      element.scrollTop = element.scrollHeight - element.clientHeight
    }
  }, [errors])
  return (
    <CollapsiblePanel {...props}>
      <div className="h-full relative">
        <div className="absolute inset-0 flex flex-col">
          <ReactJsonTypeHack
            src={errors}
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
