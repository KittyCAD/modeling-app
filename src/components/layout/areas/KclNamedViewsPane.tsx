import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { NamedViews } from '@src/lib/namedViews/NamedViews'

export function KclNamedViewsPane(props: AreaTypeComponentProps) {
  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <NamedViews
        renderHeader={(actions) => (
          <LayoutPanelHeader
            id={props.layout.id}
            icon="namedView"
            title={props.layout.label}
            Menu={actions}
            onClose={props.onClose}
          />
        )}
      />
    </LayoutPanel>
  )
}
