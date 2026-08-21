import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'
import { useSignals } from '@preact/signals-react/runtime'

import { RowItemWithIconMenuAndToggle } from '@src/components/RowItemWithIconMenuAndToggle'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useReliesOnEngine } from '@src/hooks/useReliesOnEngine'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import {
  KCL_DEFAULT_VIEW_NAME,
  listNamedViews,
} from '@src/lang/std/kclNamedViews'
import { useSingletons } from '@src/lib/boot'
import { FILE_EXT } from '@src/lib/constants'
import type {
  ActivationTarget,
  ActiveView,
} from '@src/lib/kclNamedViewActivation'
import {
  activateNamedView,
  activeViewSignal,
  isSameView,
  isSketchSessionOpen,
  moduleKeyOf,
} from '@src/lib/kclNamedViewActivation'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { reportRejection } from '@src/lib/trap'

export type ViewRow = {
  /** Unique per row, so React keys stay stable across executions. */
  key: string
  /** What the user reads. */
  label: string
  /** What `activeViewSignal` holds when this row is active. */
  identity: ActiveView | null
  target: ActivationTarget
}

function moduleName(path: ModulePath | undefined): string | undefined {
  if (path === undefined || path.type === 'Main') {
    return undefined
  }

  const file = path.value.replace(/^.*\//, '')
  return file.endsWith(FILE_EXT) ? file.slice(0, -FILE_EXT.length) : file
}

/**
 * Returns one row per view, `Default View` first.
 *
 * A display name two modules both declare is prefixed with the declaring
 * module, as `bracket::Front`. Unique names are left bare.
 */
export function viewRows(views: KclNamedView[]): ViewRow[] {
  const nameCounts = new Map<string, number>()
  for (const view of views) {
    const name = view.artifact.name
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }

  const declared = views.map((view): ViewRow => {
    const name = view.artifact.name
    const module = moduleName(view.modulePath)
    const collides = (nameCounts.get(name) ?? 0) > 1

    return {
      key: view.artifact.id,
      label: collides && module ? `${module}::${name}` : name,
      identity: { name, moduleKey: moduleKeyOf(view.modulePath) },
      target: { kind: 'declared', view },
    }
  })

  return [
    {
      key: 'kcl-default',
      label: KCL_DEFAULT_VIEW_NAME,
      identity: null,
      target: { kind: 'kclDefault' },
    },
    ...declared,
  ]
}

export function KclNamedViewsPane(props: AreaTypeComponentProps) {
  useSignals()
  const { kclManager } = useSingletons()
  const execState = kclManager.execStateSignal.value
  const cannotReachEngine = useReliesOnEngine(
    kclManager.isExecutingSignal.value ?? false
  )
  const { state: modelingState } = useModelingContext()
  const inSketchMode = isSketchSessionOpen(modelingState)

  const rows = viewRows(
    listNamedViews({
      artifactGraph: execState.artifactGraph,
      filenames: execState.filenames,
    })
  )
  const active = activeViewSignal.value

  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="namedView"
        title={props.layout.label}
        onClose={props.onClose}
      />
      <section className="overflow-auto mr-1 pb-8">
        <ul>
          {rows.map((row, index) => (
            <li key={row.key} className="px-1 py-0.5">
              <RowItemWithIconMenuAndToggle
                isSelected={isSameView(row.identity, active)}
                disabled={cannotReachEngine || inSketchMode}
                data-testid="named-view-row"
                data-active={isSameView(row.identity, active)}
                onClick={() => {
                  activateNamedView({
                    target: row.target,
                    kclManager,
                  }).catch(reportRejection)
                }}
              >
                <span
                  data-testid="named-view-number"
                  className="inline-block w-6 mr-2 text-right tabular-nums text-chalkboard-70 dark:text-chalkboard-40"
                >
                  {index + 1}
                </span>
                <span data-testid="named-view-label">{row.label}</span>
              </RowItemWithIconMenuAndToggle>
            </li>
          ))}
        </ul>
      </section>
    </LayoutPanel>
  )
}
