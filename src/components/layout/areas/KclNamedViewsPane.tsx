import { Menu } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'

import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useReliesOnEngine } from '@src/hooks/useReliesOnEngine'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import { updateNamedViewCamera } from '@src/lang/modifyAst/namedViews'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import { listNamedViews } from '@src/lang/std/kclNamedViews'
import { ROOT_MODULE_ID } from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import {
  EXECUTION_TYPE_REAL,
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  FILE_EXT,
} from '@src/lib/constants'
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
} from '@src/lib/kclNamedViewActivation'
import { captureNamedViewCamera } from '@src/lib/kclNamedViewCamera'
import { prepareNamedViewEditCommand } from '@src/lib/kclNamedViewEdit'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { isErr, reportRejection, trap } from '@src/lib/trap'
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
  target: ActivationTarget
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
    const { camera } = view.artifact
    const details = [
      camera.look.type === 'oriented'
        ? capitaliseFC(camera.look.orientation)
        : 'Directed',
      camera.distance === null ? undefined : `${roundOff(camera.distance)}mm`,
      capitaliseFC(camera.projection),
    ]
      .filter(Boolean)
      .join(' ')

    return {
      key: view.artifact.id,
      label: collides && module ? `${module}::${name}` : name,
      details,
      identity: { name, moduleKey: moduleKeyOf(view.modulePath) },
      target: { kind: 'declared', view },
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

export function KclNamedViewsPane(props: AreaTypeComponentProps) {
  useSignals()
  const app = useApp()
  const commandState = app.commands.useState()
  const isEditingNamedView =
    commandState.context.selectedCommand?.name === 'Named View' &&
    Boolean(commandState.context.argumentsToSubmit.nodeToEdit)
  const canManageViews = app.userFeatures.useHas(
    EXPERIMENTAL_POINT_AND_CLICK_FLAG,
    false
  )
  const { kclManager } = useSingletons()
  const execState = kclManager.execStateSignal.value
  const cannotReachEngine = useReliesOnEngine(
    kclManager.isExecutingSignal.value ?? false
  )
  const { state: modelingState } = useModelingContext()
  const inSketchMode = isSketchSessionOpen(modelingState)

  const views = listNamedViews({
    artifactGraph: execState.artifactGraph,
    filenames: execState.filenames,
  })
  const rows = viewRows(views)
  const active = activeViewSignal.value
  const actionsDisabled =
    cannotReachEngine || inSketchMode || isEditingNamedView

  const editView = (view: KclNamedView) => {
    prepareNamedViewEditCommand({
      artifact: view.artifact,
      ast: kclManager.ast,
      code: kclManager.code,
      artifactGraph: execState.artifactGraph,
      rustContext: kclManager.rustContext,
    })
      .then((event) => {
        if (trap(event)) return
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

  const updateViewCamera = async (view: KclNamedView) => {
    try {
      const camera = await captureNamedViewCamera(
        kclManager.sceneInfra.camControls
      )
      if (isErr(camera)) {
        toast.error(camera.message)
        return
      }

      const wasmInstance = await kclManager.wasmInstancePromise
      const modifiedAst = updateNamedViewCamera({
        ast: kclManager.ast,
        pathToNode: view.artifact.codeRef.pathToNode,
        camera,
        wasmInstance,
      })
      if (isErr(modifiedAst)) {
        toast.error(modifiedAst.message)
        return
      }

      await updateModelingState(modifiedAst, EXECUTION_TYPE_REAL, kclManager)
      const updatedView = listNamedViews(kclManager.execState).find(
        (updated) =>
          updated.artifact.name === view.artifact.name &&
          updated.moduleId === view.moduleId
      )
      if (updatedView) {
        await activateNamedView({
          target: { kind: 'declared', view: updatedView },
          kclManager,
          restoreCamera: false,
        })
      }
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : `Could not update “${view.artifact.name}”.`
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
                app.commands.actor.send({
                  type: 'Find and select command',
                  data: { name: 'Named View', groupId: 'modeling' },
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
              row.target.kind === 'declared' &&
              canManageNamedView(row.target.view)
                ? row.target.view
                : undefined
            const isActive = isSameView(row.identity, active)
            const editDisabled = actionsDisabled || isActive

            return (
              <li
                key={row.key}
                className="flex h-7 min-w-0 select-none items-center gap-1 px-1 text-sm hover:bg-chalkboard-10 focus-within:bg-chalkboard-20 dark:hover:bg-chalkboard-90 dark:focus-within:bg-chalkboard-80"
                data-testid="named-view-row"
                data-active={isActive}
              >
                <span
                  data-testid="named-view-number"
                  className="w-5 shrink-0 text-right text-xs tabular-nums text-chalkboard-60 dark:text-chalkboard-50"
                >
                  {index + 1}
                </span>
                <button
                  type="button"
                  className="reset grid h-6 w-6 shrink-0 place-items-center border-none text-chalkboard-70 hover:text-primary focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-default disabled:opacity-50 dark:text-chalkboard-30"
                  aria-label={
                    isActive ? `${row.label} is active` : `Apply ${row.label}`
                  }
                  aria-pressed={isActive}
                  disabled={actionsDisabled}
                  onClick={() => {
                    activateNamedView({
                      target: row.target,
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
                  className="reset flex min-w-0 flex-1 items-center gap-2 self-stretch border-none text-left !text-xs focus-visible:ring-1 focus-visible:ring-primary"
                  aria-label={row.label}
                  disabled={!manageableView || editDisabled}
                  onDoubleClick={(event) => {
                    if (!manageableView || editDisabled) return
                    event.preventDefault()
                    editView(manageableView)
                  }}
                >
                  <span
                    data-testid="named-view-label"
                    className="min-w-0 truncate"
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
                {manageableView && (
                  <ActionButton
                    Element="button"
                    aria-label="Update from current camera"
                    title="Update from current camera"
                    data-testid="named-view-update-camera"
                    disabled={editDisabled}
                    tabIndex={0}
                    iconStart={{
                      icon: 'camera',
                      iconClassName: '!text-current',
                      bgClassName: 'bg-transparent dark:bg-transparent',
                    }}
                    className="h-6 w-6 shrink-0 justify-center !p-0 !bg-transparent hover:text-primary border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 !outline-none disabled:opacity-40"
                    onClick={() => void updateViewCamera(manageableView)}
                  />
                )}
                {manageableView ? (
                  <HeaderMenu
                    aria-label="Named view actions"
                    data-testid="named-view-actions"
                    disabled={actionsDisabled}
                  >
                    <Menu.Item disabled={editDisabled}>
                      <button
                        type="button"
                        className="menuButton"
                        disabled={editDisabled}
                        onClick={() => editView(manageableView)}
                      >
                        Edit
                      </button>
                    </Menu.Item>
                    <Menu.Item disabled={actionsDisabled}>
                      <button
                        type="button"
                        className="menuButton"
                        onClick={() => void removeView(manageableView)}
                      >
                        Remove
                      </button>
                    </Menu.Item>
                  </HeaderMenu>
                ) : row.target.kind === 'declared' &&
                  !canManageNamedView(row.target.view) ? (
                  <CustomIcon
                    name="lockClosed"
                    className="mx-1 h-4 w-4 shrink-0 text-chalkboard-50"
                    aria-label="Named view is read only"
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>
    </LayoutPanel>
  )
}
