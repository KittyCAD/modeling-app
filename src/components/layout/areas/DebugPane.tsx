import { CamDebugSettings } from '@src/clientSideScene/ClientSideSceneComp'
import { AstExplorer } from '@src/components/AstExplorer'
import { DebugArtifactGraph } from '@src/components/DebugArtifactGraph'
import { DebugSelections } from '@src/components/DebugSelections'
import { EngineCommands } from '@src/components/EngineCommands'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import type { AreaTypeComponentProps } from '@src/lib/layout'

export function DebugPane(props: AreaTypeComponentProps) {
  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="bug"
        title={props.layout.label}
        Menu={null}
        onClose={props.onClose}
      />
      <DebugPaneContent />
    </LayoutPanel>
  )
}

export const DebugPaneContent = () => {
  return (
    <div className="relative">
      <section
        data-testid="debug-panel"
        className="absolute inset-0 p-2 box-border overflow-auto"
      >
        <div className="flex flex-col">
          <EngineCommands />
          <CamDebugSettings />
          <AstExplorer />
          <DebugArtifactGraph />
          <DebugSelections />
        </div>
      </section>
    </div>
  )
}
