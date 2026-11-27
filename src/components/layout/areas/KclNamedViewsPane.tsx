import { selectCommand } from '@src/lib/commandUtils'
import { useSignals } from '@preact/signals-react/runtime'
import type { ArtifactCameraLook } from '@rust/kcl-lib/bindings/Artifact'
import type { ResolvedNamedView } from '@rust/kcl-lib/bindings/ResolvedNamedView'
import type { ComponentProps, ReactNode } from 'react'
import { useRef } from 'react'

import { ActionButton } from '@src/components/ActionButton'
import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import Tooltip from '@src/components/Tooltip'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useReliesOnEngine } from '@src/hooks/useReliesOnEngine'
import { filterArtifacts } from '@src/lang/std/artifactGraph'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import { namedViewDisplayNames } from '@src/lang/std/kclNamedViews'
import type { ExecState } from '@src/lang/wasm'
import { ROOT_MODULE_ID } from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import { sendDeleteCommand } from '@src/lib/featureTree'
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
  resetNamedViewSession,
} from '@src/lib/kclNamedViewActivation'
import { prepareNamedViewEditCommand } from '@src/lib/kclNamedViewEdit'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { reportRejection, trap } from '@src/lib/trap'
import { capitaliseFC, roundOff } from '@src/lib/utils'
import { getKclDefaultViewName } from '@src/lib/wasm_lib_wrapper'
import toast from 'react-hot-toast'

export type ViewRow = {
  /** Unique per row, so React keys stay stable across executions. */
  key: string
  /** What the user reads. */
  label: string
  details?: string
  /** What `activeViewSignal` holds when this row is active. */
  identity: ActiveView
  target: ActivationTarget | null
  view?: KclNamedView
  editableView?: KclNamedView
  error?: string
}

export function canManageNamedView(view: KclNamedView): boolean {
  // One call inside a function can produce several views from the same source.
  return (
    view.moduleId === ROOT_MODULE_ID &&
    !view.artifact.codeRef.pathToNode.some(
      ([, type]) => type === 'FunctionExpression'
    )
  )
}

function cameraLookLabel(look: ArtifactCameraLook): string {
  switch (look.type) {
    case 'oriented':
      return capitaliseFC(look.orientation)
    case 'directed':
      return 'Directed'
  }
}

function viewFromArtifact(
  artifact: KclNamedView['artifact'],
  filenames: ExecState['filenames']
): KclNamedView {
  const moduleId = artifact.declaringModuleId
  return { artifact, moduleId, modulePath: filenames[moduleId] }
}

function viewIdentity(view: KclNamedView): ActiveView {
  return {
    name: view.artifact.name,
    moduleKey: moduleKeyOf(view.modulePath),
  }
}

function matchesNamedViewDeclaration(
  view: KclNamedView,
  candidate: KclNamedView
): boolean {
  if (view.artifact.name !== candidate.artifact.name) return false

  if (
    view.moduleId === ROOT_MODULE_ID &&
    candidate.moduleId === ROOT_MODULE_ID
  ) {
    return true
  }

  const moduleKey = moduleKeyOf(view.modulePath)
  return (
    moduleKey !== undefined && moduleKey === moduleKeyOf(candidate.modulePath)
  )
}

/** Returns Default View followed by the views produced by execution. */
export function viewRows(
  views: KclNamedView[],
  namedViewResolution: ExecState['namedViews'] = null
): ViewRow[] {
  const remaining = new Set(views)
  const entries: {
    view: KclNamedView
    editableView?: KclNamedView
    resolved?: ResolvedNamedView
    error?: string
    key: string
  }[] = []
  if (namedViewResolution) {
    const { batch, artifacts, filenames } = namedViewResolution
    const resolved = new Map(
      batch.namedViews.map((view) => [view.info.artifactId, view])
    )
    const failures = new Map(
      batch.failures.map((failure) => [failure.artifactId, failure.message])
    )

    for (const artifact of artifacts.values()) {
      const view = viewFromArtifact(artifact, filenames)
      // Source edits require an artifact from the graph used by the editor.
      const exactMatch = views.find(
        (candidate) => candidate.artifact === artifact
      )
      const editableView =
        exactMatch ??
        views.find(
          (candidate) =>
            remaining.has(candidate) &&
            matchesNamedViewDeclaration(view, candidate)
        )
      if (editableView) remaining.delete(editableView)
      entries.push({
        view,
        editableView,
        resolved: resolved.get(artifact.id),
        error: failures.get(artifact.id),
        key: artifact.id,
      })
    }
  }
  for (const view of remaining) {
    entries.push({
      view,
      editableView: view,
      key: namedViewResolution?.artifacts.has(view.artifact.id)
        ? `pending:${view.artifact.id}`
        : view.artifact.id,
    })
  }

  const names = namedViewDisplayNames(entries.map(({ view }) => view))
  const declared = entries.map((entry, index): ViewRow => {
    const { view, resolved, error, editableView, key } = entry
    const camera = resolved?.cameraIntent ?? view.artifact.camera
    const details = [
      cameraLookLabel(camera.look),
      camera.distance === null ? undefined : `${roundOff(camera.distance)}mm`,
      capitaliseFC(camera.projection),
    ]
      .filter(Boolean)
      .join(' ')

    return {
      key,
      label: names[index],
      details,
      identity: viewIdentity(view),
      target:
        resolved && error === undefined
          ? { kind: 'declared', view: resolved }
          : null,
      view,
      editableView,
      error,
    }
  })

  return [
    {
      key: 'kcl-default',
      label: getKclDefaultViewName(),
      identity: 'kclDefault',
      target: { kind: 'kclDefault' },
    },
    ...declared,
  ]
}

function NamedViewRow({
  children,
  isActive,
  menuItems,
}: {
  children: ReactNode
  isActive: boolean
  menuItems?: ComponentProps<typeof ContextMenu>['items']
}) {
  const menuRef = useRef<HTMLLIElement>(null)
  return (
    <li
      ref={menuRef}
      className="flex h-7 min-w-0 select-none items-center gap-1 px-1 text-sm hover:bg-chalkboard-10 focus-within:bg-chalkboard-20 dark:hover:bg-chalkboard-90 dark:focus-within:bg-chalkboard-80"
      data-testid="named-view-row"
      data-active={isActive}
    >
      {children}
      {menuItems && (
        <ContextMenu menuTargetElement={menuRef} items={menuItems} />
      )}
    </li>
  )
}

export function KclNamedViewsPane(props: AreaTypeComponentProps) {
  useSignals()
  const app = useApp()
  const commandState = app.commands.useState()
  const isEditingNamedView =
    commandState.context.selectedCommand?.name === 'Named View' &&
    Boolean(commandState.context.argumentsToSubmit.nodeToEdit)
  const canManageViews = commandState.context.commands.some(
    (command) => command.groupId === 'modeling' && command.name === 'Named View'
  )
  const { kclManager } = useSingletons()
  const execState = kclManager.execStateSignal.value
  const cannotReachEngine = useReliesOnEngine(
    kclManager.isExecutingSignal.value ?? false
  )
  const { state: modelingState } = useModelingContext()
  const inSketchMode = isSketchSessionOpen(modelingState)

  const views = Array.from(
    filterArtifacts({ types: ['namedView'] }, execState.artifactGraph).values(),
    (artifact) => viewFromArtifact(artifact, execState.filenames)
  )
  const rows = viewRows(views, execState.namedViews)
  const active = activeViewSignal.value
  const actionsDisabled =
    cannotReachEngine || inSketchMode || isEditingNamedView

  const editView = (view: KclNamedView, identity: ActiveView) => {
    prepareNamedViewEditCommand({
      artifact: view.artifact,
      ast: kclManager.ast,
      code: kclManager.code,
      artifactGraph: execState.artifactGraph,
      rustContext: kclManager.rustContext,
    })
      .then((event) => {
        if (trap(event)) return
        if (isSameView(activeViewSignal.peek(), identity)) {
          resetNamedViewSession()
        }
        app.commands.actor.send(event)
      })
      .catch((reason) => toast.error(String(reason)))
  }

  const removeView = async (view: KclNamedView) => {
    const artifact = kclManager.execState.artifactGraph.get(view.artifact.id)
    if (artifact?.type !== 'namedView') {
      toast.error(`Could not find “${view.artifact.name}”.`)
      return
    }
    try {
      await sendDeleteCommand({
        artifact,
        targetSourceRange: artifact.codeRef.range,
        systemDeps: {
          kclManager,
          rustContext: kclManager.rustContext,
          sceneEntitiesManager: kclManager.sceneEntitiesManager,
        },
      })
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : `Could not remove “${view.artifact.name}”.`
      )
    }
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
          canManageViews ? (
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
              className="h-6 w-6 shrink-0 justify-center !p-0 !bg-transparent hover:text-primary border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 !outline-none disabled:opacity-40"
              onClick={() => {
                selectCommand(app.commands.actor, {
                  name: 'Named View',
                  groupId: 'modeling',
                })
              }}
            />
          ) : undefined
        }
        onClose={props.onClose}
      />
      <section className="overflow-auto pb-8">
        <ul className="py-0.5" aria-label="Named views">
          {rows.map((row, index) => {
            const manageableView =
              canManageViews &&
              row.editableView &&
              canManageNamedView(row.editableView)
                ? row.editableView
                : undefined
            const { target } = row
            const isActive = target !== null && isSameView(row.identity, active)

            return (
              <NamedViewRow
                key={row.key}
                isActive={isActive}
                menuItems={
                  manageableView
                    ? [
                        <ContextMenuItem
                          disabled={actionsDisabled}
                          onClick={() => editView(manageableView, row.identity)}
                        >
                          Edit
                        </ContextMenuItem>,
                        <ContextMenuItem
                          disabled={actionsDisabled}
                          onClick={() => void removeView(manageableView)}
                        >
                          Remove
                        </ContextMenuItem>,
                      ]
                    : undefined
                }
              >
                <span
                  data-testid="named-view-number"
                  className="w-5 shrink-0 text-right text-xs tabular-nums text-chalkboard-60 dark:text-chalkboard-50"
                >
                  {index + 1}
                </span>
                <button
                  type="button"
                  className="reset grid h-6 w-6 shrink-0 place-items-center border-none text-chalkboard-70 hover:text-primary focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-default disabled:!bg-transparent disabled:opacity-50 dark:text-chalkboard-30"
                  aria-label={
                    isActive ? `${row.label} is active` : `Apply ${row.label}`
                  }
                  aria-pressed={isActive}
                  disabled={target === null || actionsDisabled}
                  onClick={() => {
                    if (target === null) return
                    activateNamedView({
                      target,
                      kclManager,
                    }).catch(reportRejection)
                  }}
                >
                  <CustomIcon
                    name="viewFrame"
                    className="col-start-1 row-start-1 h-5 w-5"
                    aria-hidden
                  />
                  {isActive && (
                    <CustomIcon
                      name="eyeOpen"
                      className="col-start-1 row-start-1 h-4 w-4"
                      aria-hidden
                    />
                  )}
                </button>
                <button
                  type="button"
                  className="reset flex min-w-0 flex-1 items-center gap-2 self-stretch border-none text-left !text-xs focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-default disabled:!bg-transparent"
                  aria-label={row.label}
                  disabled={!manageableView || actionsDisabled}
                  onDoubleClick={(event) => {
                    if (!manageableView || actionsDisabled) return
                    event.preventDefault()
                    editView(manageableView, row.identity)
                  }}
                >
                  <span
                    data-testid="named-view-label"
                    className="min-w-0 truncate text-chalkboard-100 dark:text-chalkboard-10"
                  >
                    {row.label}
                  </span>
                  {row.details && (
                    <>
                      <span
                        aria-hidden
                        className="h-3 shrink-0 border-l border-chalkboard-40 dark:border-chalkboard-60"
                      />
                      <span
                        data-testid="named-view-details"
                        className="min-w-0 flex-1 truncate text-chalkboard-60 dark:text-chalkboard-50"
                        title={row.details}
                      >
                        {row.details}
                      </span>
                    </>
                  )}
                </button>
                {row.error !== undefined && (
                  <button
                    type="button"
                    className="reset grid h-6 w-6 shrink-0 place-items-center border-none text-destroy-80 focus-visible:ring-1 focus-visible:ring-primary dark:text-destroy-40"
                    aria-label={row.error}
                  >
                    <CustomIcon
                      name="triangleExclamation"
                      className="h-4 w-4"
                      aria-hidden
                    />
                    <Tooltip position="left">{row.error}</Tooltip>
                  </button>
                )}
                {target === null && row.error === undefined && (
                  <span className="shrink-0 text-xs text-chalkboard-60 dark:text-chalkboard-50">
                    Waiting for execution
                  </span>
                )}
                {row.view && !canManageNamedView(row.view) ? (
                  <CustomIcon
                    name="lockClosed"
                    className="mx-1 h-4 w-4 shrink-0 text-chalkboard-50"
                    aria-label="Named view is read only"
                  />
                ) : null}
              </NamedViewRow>
            )
          })}
        </ul>
      </section>
    </LayoutPanel>
  )
}
