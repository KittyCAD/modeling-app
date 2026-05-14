import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { effect } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import type { SketchSolverTrace } from '@rust/kcl-lib/bindings/SketchSolverTrace'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import type { AreaTypeComponentProps } from '@src/lib/layout/types'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import {
  SKETCH_DEBUGGER_AREA_TYPE,
  clearSketchSolverDebugOperations,
  sketchDebuggerLayoutContribution,
  sketchSolverDebuggerOperations,
} from '@src/machines/sketchSolve/sketchSolverDebugger'
import type { SketchSolverDebuggerOperation } from '@src/machines/sketchSolve/sketchSolverDebugger'
import {
  layoutAreaLibraryValueSpec,
  layoutContributionsValueSpec,
  layoutService,
} from '@src/registry/contracts/layout'
import { projectService } from '@src/registry/contracts/project'
import { settingsValueSpec } from '@src/registry/contracts/settings'

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
  const [latestOperation, ...previousOperations] = operations

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
        Menu={
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
        }
      />
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {latestOperation ? (
          <div className="flex flex-col gap-3">
            <OperationTextBlock
              operation={latestOperation}
              label="Latest edit"
            />
            {previousOperations.length ? (
              <details className="border border-chalkboard-20 bg-chalkboard-5 dark:border-chalkboard-80 dark:bg-chalkboard-100">
                <summary className="cursor-pointer px-2 py-1 font-medium">
                  Log ({previousOperations.length})
                </summary>
                <div className="flex flex-col gap-2 border-t border-chalkboard-20 p-2 dark:border-chalkboard-80">
                  {previousOperations.map((operation) => (
                    <details
                      key={operation.id}
                      className="border border-chalkboard-20 bg-chalkboard-10 dark:border-chalkboard-80 dark:bg-chalkboard-90"
                    >
                      <summary className="cursor-pointer px-2 py-1">
                        {operation.label} - {operation.phase} -{' '}
                        {new Date(operation.committedAt).toLocaleTimeString()}
                      </summary>
                      <div className="border-t border-chalkboard-20 p-2 dark:border-chalkboard-80">
                        <OperationTextBlock operation={operation} />
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            ) : null}
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

function OperationTextBlock({
  operation,
  label,
}: {
  operation: SketchSolverDebuggerOperation
  label?: string
}) {
  return (
    <section className="border border-chalkboard-20 bg-chalkboard-10 dark:border-chalkboard-80 dark:bg-chalkboard-100">
      <header className="border-b border-chalkboard-20 px-2 py-1 dark:border-chalkboard-80">
        {label ? <div className="font-medium">{label}</div> : null}
        <div className="text-[10px] text-chalkboard-60 dark:text-chalkboard-50">
          {operation.label} - {operation.phase} -{' '}
          {new Date(operation.committedAt).toLocaleTimeString()}
        </div>
      </header>
      <div className="flex flex-col gap-2 p-2">
        {operation.traces.map((trace, index) => (
          <TraceTextBlock
            key={`${operation.id}-${trace.sketchId}-${index}`}
            trace={trace}
          />
        ))}
      </div>
    </section>
  )
}

function TraceTextBlock({ trace }: { trace: SketchSolverTrace }) {
  return (
    <pre className="max-h-[40rem] overflow-auto whitespace-pre-wrap border border-chalkboard-20 bg-chalkboard-5 p-2 font-mono text-[10px] leading-relaxed dark:border-chalkboard-80 dark:bg-chalkboard-90">
      {formatTraceAsProblemText(trace)}
    </pre>
  )
}

function formatTraceAsProblemText(trace: SketchSolverTrace): string {
  const configItems = trace.items.filter((item) => item.kind === 'config')
  const constraintItems = trace.items.filter(
    (item) => item.kind === 'constraint'
  )
  const guessItems = trace.items.filter((item) => item.kind === 'initialGuess')
  const otherItems = trace.items.filter(
    (item) =>
      item.kind !== 'config' &&
      item.kind !== 'constraint' &&
      item.kind !== 'initialGuess'
  )
  const lines = [
    `# sketch ${trace.sketchId}`,
    `# required ${trace.requiredConstraintCount} optional ${trace.optionalConstraintCount} guesses ${trace.initialGuessCount}`,
  ]

  if (configItems.length > 0) {
    lines.push('', '# config')
    lines.push(...configItems.map(formatTraceItem))
  }

  lines.push('', '# constraints')
  lines.push(...constraintItems.map(formatTraceItem))

  lines.push('', '# guesses')
  lines.push(...guessItems.map(formatTraceItem))

  if (otherItems.length > 0) {
    lines.push('', '# other')
    lines.push(...otherItems.map(formatTraceItem))
  }

  return lines.join('\n')
}

function formatTraceItem(item: SketchSolverTrace['items'][number]): string {
  const detail = item.detail.trim()
  if (item.kind === 'constraint') {
    return `${item.label} ${formatConstraintDetail(detail)}`
  }

  if (item.kind === 'initialGuess') {
    return `${item.label} roughly ${detail}`
  }

  return `${item.label}\n${detail}`
}

function formatConstraintDetail(detail: string): string {
  const [firstLine, ...rest] = detail.split('\n')
  const priority = firstLine?.match(/^priority\s+(.+)$/)?.[1]
  const constraint = rest.join('\n').trim()
  if (priority && constraint) {
    return `priority ${priority} ${constraint}`
  }

  return detail
}

export const sketchDebuggerPaneExtension = defineRegistryItemFactory((ctx) => {
  const project = ctx.services.signal(projectService)
  const layout = ctx.services.signal(layoutService)
  let disposed = false
  let stopLayoutEffect: (() => void) | undefined

  queueMicrotask(() => {
    if (disposed) {
      return
    }

    stopLayoutEffect = effect(() => {
      const layoutApi = layout.value
      const projectApi = project.value
      if (
        !layoutApi ||
        !projectApi ||
        !shouldShowSketchDebuggerPane(projectApi.settings.value)
      ) {
        return
      }

      layoutApi.ensureContribution(sketchDebuggerLayoutContribution)
    })
  })

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
          ...sketchDebuggerLayoutContribution,
        }),
      ],
      dispose: () => {
        disposed = true
        stopLayoutEffect?.()
      },
    }),
  }
}, 'mode-sketch.sketch-debugger-pane')
