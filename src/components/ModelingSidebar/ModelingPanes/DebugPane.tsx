import { DebugFeatureTree } from 'components/DebugFeatureTree'
import { AstExplorer } from '../../AstExplorer'
import { EngineCommands } from '../../EngineCommands'
import { CamDebugSettings } from 'clientSideScene/ClientSideSceneComp'

export const DebugPane = () => {
  return (
    <section
      data-testid="debug-panel"
      className="absolute inset-0 p-2 box-border overflow-auto"
    >
      <div className="flex flex-col">
        <EngineCommands />
        <CamDebugSettings />
        <AstExplorer />
        <DebugFeatureTree />
      </div>
    </section>
  )
}
