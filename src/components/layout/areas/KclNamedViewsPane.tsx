import { useSignals } from '@preact/signals-react/runtime'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'

import { ActionButton } from '@src/components/ActionButton'
import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { RowItemWithIconMenuAndToggle } from '@src/components/RowItemWithIconMenuAndToggle'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useReliesOnEngine } from '@src/hooks/useReliesOnEngine'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import {
  KCL_DEFAULT_VIEW_NAME,
  listNamedViews,
} from '@src/lang/std/kclNamedViews'
import { ROOT_MODULE_ID } from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import { FILE_EXT } from '@src/lib/constants'
import { sendDeleteCommand } from '@src/lib/featureTree'
import { prepareNamedViewEditCommand } from '@src/lib/kclNamedViewEdit'
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
import { isErr, reportRejection } from '@src/lib/trap'
import { useRef } from 'react'
import toast from 'react-hot-toast'

export type ViewRow = {
  /** Unique per row, so React keys stay stable across executions. */
  key: string
  /** What the user reads. */
  label: string
  /** Compact camera summary shown beside the name. */
  detail?: string
  /** What `activeViewSignal` holds when this row is active. */
  identity: ActiveView | null
  target: ActivationTarget
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function namedViewDetail(view: KclNamedView): string {
  const { camera } = view.artifact
  const look =
    camera.look.type === 'oriented'
      ? titleCase(camera.look.orientation)
      : 'Directed'
  const distance = camera.distance === null ? '' : ` ${camera.distance}mm`

  return `${look}${distance} ${titleCase(camera.projection)}`
}

export function canManageNamedView(view: KclNamedView): boolean {
  return view.moduleId === ROOT_MODULE_ID
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
      detail: namedViewDetail(view),
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
  const app = useApp()
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
  const actionsDisabled = cannotReachEngine || inSketchMode

  const editView = (view: KclNamedView) => {
    const artifact = execState.artifactGraph.get(view.artifact.id)
    if (artifact?.type !== 'namedView') {
      toast.error(`Could not find “${view.artifact.name}”.`)
      return
    }
    prepareNamedViewEditCommand({
      artifact,
      ast: kclManager.ast,
      code: kclManager.code,
      artifactGraph: execState.artifactGraph,
      rustContext: kclManager.rustContext,
    })
      .then((event) => {
        if (isErr(event)) {
          toast.error(event.message)
          return
        }
        app.commands.actor.send(event)
      })
      .catch((reason) => {
        toast.error(
          reason instanceof Error
            ? reason.message
            : `Could not edit “${view.artifact.name}”.`
        )
      })
  }

  const deleteView = (view: KclNamedView) => {
    const artifact = execState.artifactGraph.get(view.artifact.id)
    if (artifact?.type !== 'namedView') {
      toast.error(`Could not find “${view.artifact.name}”.`)
      return
    }
    sendDeleteCommand({
      artifact,
      targetSourceRange: artifact.codeRef.range,
      systemDeps: {
        kclManager,
        rustContext: kclManager.rustContext,
        sceneEntitiesManager: kclManager.sceneEntitiesManager,
      },
    }).catch((reason) => {
      toast.error(
        reason instanceof Error
          ? reason.message
          : `Could not delete “${view.artifact.name}”.`
      )
    })
  }

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
        Menu={
          <ActionButton
            Element="button"
            aria-label="Create named view"
            title="Create named view"
            data-testid="named-view-create"
            disabled={actionsDisabled}
            tabIndex={0}
            iconStart={{
              icon: 'plus',
              iconClassName: '!text-current',
              bgClassName: 'bg-transparent dark:bg-transparent',
            }}
            className="!p-0 !bg-transparent hover:text-primary border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 !outline-none"
            onClick={() => {
              app.commands.actor.send({
                type: 'Find and select command',
                data: { name: 'Named View', groupId: 'modeling' },
              })
            }}
          />
        }
        onClose={props.onClose}
      />
      <section className="overflow-auto mr-1 pb-8">
        <ul>
          {rows.map((row, index) => {
            const manageableView =
              row.target.kind === 'declared' &&
              canManageNamedView(row.target.view)
                ? row.target.view
                : undefined

            return (
              <li key={row.key} className="px-1 py-0.5">
                <RowItemWithIconMenuAndToggle
                  isSelected={isSameView(row.identity, active)}
                  disabled={actionsDisabled}
                  data-testid="named-view-row"
                  data-active={isSameView(row.identity, active)}
                  onDoubleClick={
                    manageableView && !actionsDisabled
                      ? () => editView(manageableView)
                      : undefined
                  }
                  onClick={() => {
                    activateNamedView({
                      target: row.target,
                      kclManager,
                    }).catch(reportRejection)
                  }}
                  LabelSecondary={
                    row.detail ? (
                      <span className="truncate text-xs text-chalkboard-60 dark:text-chalkboard-50">
                        <span aria-hidden className="mr-2">
                          |
                        </span>
                        {row.detail}
                      </span>
                    ) : undefined
                  }
                  Toggle={
                    manageableView ? (
                      <NamedViewRowMenu
                        disabled={actionsDisabled}
                        onEdit={() => editView(manageableView)}
                        onDelete={() => deleteView(manageableView)}
                      />
                    ) : undefined
                  }
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
            )
          })}
        </ul>
      </section>
    </LayoutPanel>
  )
}

function NamedViewRowMenu({
  disabled,
  onEdit,
  onDelete,
}: {
  disabled: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <ActionButton
        ref={triggerRef}
        Element="button"
        aria-label="Named view actions"
        title="Named view actions"
        data-testid="named-view-actions"
        disabled={disabled}
        tabIndex={0}
        iconStart={{
          icon: 'three-dots',
          iconClassName: '!text-current',
          bgClassName: 'bg-transparent dark:bg-transparent',
        }}
        className="!p-0 !bg-transparent border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 !outline-none"
      />
      <ContextMenu
        event="mouseup"
        menuTargetElement={triggerRef}
        items={[
          <ContextMenuItem
            key="edit"
            data-testid="named-view-edit"
            onClick={onEdit}
            disabled={disabled}
          >
            Edit
          </ContextMenuItem>,
          <ContextMenuItem
            key="delete"
            icon="trash"
            data-testid="named-view-delete"
            onClick={onDelete}
            disabled={disabled}
          >
            Delete
          </ContextMenuItem>,
        ]}
      />
    </>
  )
}
