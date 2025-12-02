import ReactJsonView from '@microlink/react-json-view'

import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import { kclManager } from '@src/lib/singletons'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'

export function LogsPane(props: AreaTypeComponentProps) {
  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="logs"
        title={props.layout.id}
        Menu={null}
        onClose={props.onClose}
      />
      <LogsPaneContent />
    </LayoutPanel>
  )
}
export const LogsPaneContent = () => {
  const theme = useResolvedTheme()
  const logs = kclManager.logsSignal.value
  return (
    <div className="overflow-hidden">
      <div className="absolute inset-0 p-2 flex flex-col overflow-auto">
        <ReactJsonView
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
