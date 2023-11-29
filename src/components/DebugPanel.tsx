import { CollapsiblePanel, CollapsiblePanelProps } from './CollapsiblePanel'
import { AstExplorer } from './AstExplorer'
import { EngineCommands } from './EngineCommands'

export const DebugPanel = ({ className, ...props }: CollapsiblePanelProps) => {
  return (
    <CollapsiblePanel
      {...props}
      className={
        '!absolute overflow-auto !h-auto bottom-5 right-5 ' + className
      }
      // header height, top-5, and bottom-5
      style={{ maxHeight: 'calc(100% - 3rem - 1.25rem - 1.25rem)' }}
      detailsTestId="debug-panel"
    >
      <section className="p-4 flex flex-col gap-4">
        <EngineCommands />
        <div style={{ height: '400px' }} className="overflow-y-auto">
          <AstExplorer />
        </div>
      </section>
    </CollapsiblePanel>
  )
}
