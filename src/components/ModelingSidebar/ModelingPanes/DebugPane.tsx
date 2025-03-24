import { CamDebugSettings } from '@src/clientSideScene/ClientSideSceneComp'
import { AstExplorer } from '@src/components/AstExplorer'
import { DebugArtifactGraph } from '@src/components/DebugArtifactGraph'
import { EngineCommands } from '@src/components/EngineCommands'

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
