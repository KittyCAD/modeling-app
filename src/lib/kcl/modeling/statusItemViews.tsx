import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { useSignals } from '@preact/signals-react/runtime'
import { ScreenshotStatusBarItemView } from '@src/registry/extensions/engineScene/ScreenshotStatusBarItemView'
import { MeasurementStatusBarItemView } from '@src/registry/extensions/engineScene/MeasurementToolView'
import { PhysicalAnalysisStatusBarItemView } from '@src/registry/extensions/engineScene/physicalAnalysis/PhysicalAnalysisToolView'
import { SelectionFilterControlsView } from '@src/registry/extensions/engineScene/SelectionFilterControlsView'
import { SelectionStatusBarItem } from '@src/components/SelectionStatusBarItem'
import { UnitsMenuView } from '@src/components/UnitsMenuView'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import { viewSceneToolsHost } from '@src/lib/kcl/modeling/sceneToolsHost'
import { getSelectionTypeDisplayText } from '@src/lib/selections'
import { EngineExecutionStatusTooltip } from '@src/registry/extensions/engineScene/executionIndicator/EngineExecutionStatusTooltip'
import { setViewFileUnits } from '@src/lib/kcl/modeling/viewCommands'
import { isErr, reportRejection } from '@src/lib/trap'
import { signal } from '@preact/signals-core'
import toast from 'react-hot-toast'
const noElapsed = signal<number | null>(null)

export function ScreenshotItem({ context }: { context: ModelingViewContext }) {
  useSignals()
  const scene = context.session.resource.value
  return (
    <ScreenshotStatusBarItemView
      fileOperations={context.fileOperations}
      screenshot={{ capture: () => scene?.captureScreenshot() ?? '' }}
      disabled={!scene?.selection.model.value}
    />
  )
}
export function MeasurementItem({ context }: { context: ModelingViewContext }) {
  useSignals()
  return <MeasurementStatusBarItemView host={viewSceneToolsHost(context)} />
}
export function PhysicalAnalysisItem({
  context,
}: {
  context: ModelingViewContext
}) {
  useSignals()
  return (
    <PhysicalAnalysisStatusBarItemView host={viewSceneToolsHost(context)} />
  )
}
export function FilterItem({ context }: { context: ModelingViewContext }) {
  useSignals()
  const selection = context.session.resource.value?.selection
  return (
    <SelectionFilterControlsView
      filter={selection?.filter.value ?? []}
      disabled={!selection?.pickingEnabled.value || selection.dialogOpen.value}
      onChange={(filter) => {
        const error = selection?.setFilter(filter)
        if (isErr(error)) toast.error(error.message)
      }}
    />
  )
}
export function SelectionItem({ context }: { context: ModelingViewContext }) {
  useSignals()
  const host = viewSceneToolsHost(context)
  const scene = context.session.resource.value
  const active = context.selection
  const count = active.items.value.length
  const sketch = active.items.value.some((item) => item.kind === 'sketch')
  const ast = scene?.runtime.ast.value
  const label = sketch
    ? `${count} sketch ${count === 1 ? 'entity' : 'entities'} selected`
    : ast
      ? getSelectionTypeDisplayText(ast, host.selections, host.artifactGraph)
      : count
        ? `${count} selected`
        : null
  return (
    <div className="flex" aria-label="Scene selection">
      <SelectionStatusBarItem
        label={label ?? 'No selection'}
        popoverSections={[
          {
            id: 'clear-selection',
            component: () => (
              <button
                type="button"
                className={defaultStatusBarItemClassNames}
                disabled={!active.canClear.value}
                onClick={active.clear}
              >
                Clear selection
              </button>
            ),
          },
        ]}
      />
    </div>
  )
}
export function UnitsItem({ context }: { context: ModelingViewContext }) {
  useSignals()
  const host = viewSceneToolsHost(context)
  return (
    <UnitsMenuView
      currentUnit={host.unit}
      disabled={context.executor.editor.readOnly.value || !host.idle}
      onUnitChange={(unit) => {
        setViewFileUnits(context, unit)
          .then((error) => {
            if (isErr(error)) toast.error(error.message)
          })
          .catch(reportRejection)
      }}
    />
  )
}
export function ExecutionItem({ context }: { context: ModelingViewContext }) {
  useSignals()
  const state = context.session.state.value
  const scene = context.session.resource.value
  const output = context.viewExecution.state.value
  const error =
    state.type === 'error'
      ? state.error
      : (scene?.selection.error.value ?? output.error)
  const nativeExecuting = scene?.runtime.executing.value ?? false
  const executing = output.running || nativeExecuting
  const label = error
    ? error.message
    : state.type === 'connecting'
      ? 'Connecting to engine'
      : executing
        ? nativeExecuting
          ? 'Engine executing'
          : 'Preparing model'
        : scene?.selection.model.value
          ? output.stale
            ? 'Model is out of date'
            : 'Engine execution finished'
          : 'No executed model'
  return (
    <div
      className={defaultStatusBarItemClassNames}
      role="status"
      aria-label={label}
    >
      <CustomIcon
        name={
          error
            ? 'close'
            : executing || state.type === 'connecting'
              ? 'loading'
              : 'checkmark'
        }
        className={`h-4 w-4 ${executing ? 'animate-spin' : ''}`}
      />
      <Tooltip position="top-left">
        {error ? (
          error.message
        ) : (
          <>
            <span>{label}</span>
            <EngineExecutionStatusTooltip
              isExecuting={!!executing}
              executionElapsedMs={
                output.running && !nativeExecuting
                  ? noElapsed
                  : (scene?.runtime.executionElapsedMs ?? noElapsed)
              }
              getPendingCommandCount={() =>
                Object.keys(scene?.commands.pendingCommands ?? {}).length
              }
            />
          </>
        )}
      </Tooltip>
    </div>
  )
}
