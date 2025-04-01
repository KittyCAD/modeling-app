import { CamDebugSettings } from 'clientSideScene/ClientSideSceneComp'
import { DebugArtifactGraph } from 'components/DebugArtifactGraph'

import { AstExplorer } from '../../AstExplorer'
import { EngineCommands } from '../../EngineCommands'

export const DebugPane = () => {
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
        </div>
      </section>
    </div>
  )
}
