import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import type { SketchSolverTrace } from '@rust/kcl-lib/bindings/SketchSolverTrace'
import type { SketchSolverTraceItem } from '@rust/kcl-lib/bindings/SketchSolverTraceItem'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import {
  DefaultLayoutPaneID,
  DefaultLayoutToolbarID,
} from '@src/lib/layout/configs/default'
import { LayoutType } from '@src/lib/layout/types'
import type { AreaTypeComponentProps } from '@src/lib/layout/types'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import {
  clearSketchSolverDebugOperations,
  sketchSolverDebuggerOperations,
} from '@src/machines/sketchSolve/sketchSolverDebugger'
import type { SketchSolverDebuggerOperation } from '@src/machines/sketchSolve/sketchSolverDebugger'
import {
  layoutAreaLibraryValueSpec,
  layoutContributionsValueSpec,
} from '@src/registry/contracts/layout'
import { projectService } from '@src/registry/contracts/project'
import { settingsValueSpec } from '@src/registry/contracts/settings'

const SKETCH_DEBUGGER_PANE_ID = 'sketch-debugger'
const SKETCH_DEBUGGER_AREA_TYPE = 'modeSketch.sketchDebugger'

type SketchDebuggerDebugSettings = SettingsType['debug'] & {
  showSketchDebuggerPane?: { current?: boolean }
}

function shouldShowSketchDebuggerPane(settings: SettingsType): boolean {
  return (
    (settings.debug as SketchDebuggerDebugSettings | undefined)
      ?.showSketchDebuggerPane?.current === true
  )
}

function SketchDebuggerPane(props: AreaTypeComponentProps) {
  useSignals()

  const operations = sketchSolverDebuggerOperations.value

  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none text-xs"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        title={props.layout.label}
        icon="bug"
        onClose={props.onClose}
      />
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-chalkboard-70 dark:text-chalkboard-40">
            {operations.length} solver operation
            {operations.length === 1 ? '' : 's'}
          </div>
          <button
            type="button"
            className="h-7 rounded border border-chalkboard-30 px-2 text-xs hover:bg-chalkboard-20 dark:border-chalkboard-80 dark:hover:bg-chalkboard-90"
            onClick={clearSketchSolverDebugOperations}
          >
            Clear
          </button>
        </div>
        {operations.length ? (
          <div className="flex flex-col gap-2">
            {operations.map((operation) => (
              <OperationBlock key={operation.id} operation={operation} />
            ))}
          </div>
        ) : (
          <div className="grid min-h-40 place-items-center text-center text-chalkboard-60 dark:text-chalkboard-50">
            No sketch solver inputs yet.
          </div>
        )}
      </div>
    </LayoutPanel>
  )
}

function OperationBlock({
  operation,
}: {
  operation: SketchSolverDebuggerOperation
}) {
  return (
    <section className="border border-chalkboard-20 bg-chalkboard-10 dark:border-chalkboard-80 dark:bg-chalkboard-100">
      <header className="flex items-center gap-2 border-b border-chalkboard-20 px-2 py-1 dark:border-chalkboard-80">
        <CustomIcon name="bug" className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{operation.label}</div>
          <div className="text-[10px] text-chalkboard-60 dark:text-chalkboard-50">
            {operation.phase} ·{' '}
            {new Date(operation.committedAt).toLocaleTimeString()}
          </div>
        </div>
      </header>
      <div className="flex flex-col gap-2 p-2">
        {operation.traces.map((trace, index) => (
          <TraceBlock
            key={`${operation.id}-${trace.sketchId}-${index}`}
            trace={trace}
          />
        ))}
      </div>
    </section>
  )
}

function TraceBlock({ trace }: { trace: SketchSolverTrace }) {
  return (
    <div className="border-l-2 border-primary/70 pl-2">
      <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-chalkboard-70 dark:text-chalkboard-40">
        <span>sketch {trace.sketchId}</span>
        <span>{trace.requiredConstraintCount} required</span>
        <span>{trace.optionalConstraintCount} optional</span>
        <span>{trace.initialGuessCount} guesses</span>
      </div>
      <div className="flex flex-col gap-1">
        {trace.items.map((item, index) => (
          <TraceItem key={`${item.kind}-${item.label}-${index}`} item={item} />
        ))}
      </div>
    </div>
  )
}

function TraceItem({ item }: { item: SketchSolverTraceItem }) {
  return (
    <details className="border border-chalkboard-20 bg-chalkboard-5 dark:border-chalkboard-80 dark:bg-chalkboard-90">
      <summary className="cursor-pointer px-2 py-1">
        <span className="mr-2 rounded bg-chalkboard-20 px-1 py-0.5 text-[10px] uppercase dark:bg-chalkboard-80">
          {item.kind}
        </span>
        {item.label}
      </summary>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-chalkboard-20 p-2 font-mono text-[10px] dark:border-chalkboard-80">
        {item.detail}
      </pre>
    </details>
  )
}

export const sketchDebuggerPaneExtension = defineRegistryItemFactory((ctx) => {
  const project = ctx.services.signal(projectService)

  return {
    item: defineRuntimeRegistryItem({
      id: 'mode-sketch.sketch-debugger-pane',
      provides: [
        provide(settingsValueSpec, {
          debug: {
            showSketchDebuggerPane: defineBooleanExtensionSetting({
              defaultValue: false,
              title: 'Show sketch debugger pane',
              description:
                'Whether to show a right-sidebar pane listing sketch solver preview and commit inputs.',
              commandConfig: {
                inputType: 'boolean',
              },
              userToml: {
                sectionKey: 'debug',
                tomlKey: 'show_sketch_debugger_pane',
              },
              projectToml: {
                sectionKey: 'debug',
                tomlKey: 'show_sketch_debugger_pane',
              },
            }),
          },
        }),
        provide(layoutAreaLibraryValueSpec, {
          [SKETCH_DEBUGGER_AREA_TYPE]: {
            hide: () =>
              !project.value ||
              !shouldShowSketchDebuggerPane(project.value.settings.value),
            Component: SketchDebuggerPane,
          },
        }),
        provide(layoutContributionsValueSpec, {
          id: 'mode-sketch.sketch-debugger-pane',
          kind: 'area',
          pane: {
            id: SKETCH_DEBUGGER_PANE_ID,
            label: 'Sketch Debugger',
            type: LayoutType.Simple,
            areaType: SKETCH_DEBUGGER_AREA_TYPE,
            icon: 'bug',
          },
          placement: {
            targetPaneId: DefaultLayoutToolbarID.Right,
            afterId: DefaultLayoutPaneID.TTC,
          },
          initiallyOpen: false,
        }),
      ],
    }),
  }
}, 'mode-sketch.sketch-debugger-pane')
