import { useSignals } from '@preact/signals-react/runtime'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'

import { ActionButton } from '@src/components/ActionButton'
import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useReliesOnEngine } from '@src/hooks/useReliesOnEngine'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import {
  renameNamedView,
  updateNamedViewCamera,
} from '@src/lang/modifyAst/namedViews'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import {
  KCL_DEFAULT_VIEW_NAME,
  listNamedViews,
} from '@src/lang/std/kclNamedViews'
import { ROOT_MODULE_ID } from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import { EXECUTION_TYPE_REAL, FILE_EXT } from '@src/lib/constants'
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
import { isErr, reportRejection } from '@src/lib/trap'
import { useEffect, useRef, useState } from 'react'
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

export type ViewSelection = {
  selected: Set<string>
  anchorIndex: number
}

export function nextViewSelection({
  selected,
  rowKey,
  rowIndex,
  anchorIndex,
  rowKeys,
  shiftKey,
  toggleKey,
}: {
  selected: ReadonlySet<string>
  rowKey: string
  rowIndex: number
  anchorIndex: number | null
  rowKeys: string[]
  shiftKey: boolean
  toggleKey: boolean
}): ViewSelection {
  if (shiftKey) {
    const start = Math.min(anchorIndex ?? rowIndex, rowIndex)
    const end = Math.max(anchorIndex ?? rowIndex, rowIndex)
    const range = rowKeys.slice(start, end + 1)
    return {
      selected: toggleKey ? new Set([...selected, ...range]) : new Set(range),
      anchorIndex: anchorIndex ?? rowIndex,
    }
  }

  if (toggleKey) {
    const next = new Set(selected)
    if (next.has(rowKey)) {
      next.delete(rowKey)
    } else {
      next.add(rowKey)
    }
    return { selected: next, anchorIndex: rowIndex }
  }

  return { selected: new Set([rowKey]), anchorIndex: rowIndex }
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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null)
  const [lockedKeys, setLockedKeys] = useState<Set<string>>(new Set())
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [isChangingSource, setIsChangingSource] = useState(false)
  const cancelRenameRef = useRef(false)
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
  const rowKeys = rows.map((row) => row.key)
  const rowKeySignature = rowKeys.join('\0')
  const active = activeViewSignal.value
  const actionsDisabled = cannotReachEngine || inSketchMode || isChangingSource

  useEffect(() => {
    const liveKeys = new Set(rowKeySignature.split('\0'))
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => liveKeys.has(key)))
      return next.size === current.size ? current : next
    })
    setLockedKeys((current) => {
      const next = new Set([...current].filter((key) => liveKeys.has(key)))
      return next.size === current.size ? current : next
    })
  }, [rowKeySignature])

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

  const deleteViews = async (views: KclNamedView[]) => {
    if (views.length === 0) return

    setIsChangingSource(true)
    try {
      for (const requestedView of views) {
        const currentView = listNamedViews({
          artifactGraph: kclManager.execState.artifactGraph,
          filenames: kclManager.execState.filenames,
        }).find(
          (candidate) =>
            candidate.moduleId === requestedView.moduleId &&
            candidate.artifact.name === requestedView.artifact.name
        )
        const artifact = currentView
          ? kclManager.execState.artifactGraph.get(currentView.artifact.id)
          : undefined
        if (artifact?.type !== 'namedView') {
          toast.error(`Could not find “${requestedView.artifact.name}”.`)
          return
        }

        await sendDeleteCommand({
          artifact,
          targetSourceRange: artifact.codeRef.range,
          systemDeps: {
            kclManager,
            rustContext: kclManager.rustContext,
            sceneEntitiesManager: kclManager.sceneEntitiesManager,
          },
        })
      }
      const deletedKeys = new Set(views.map((view) => view.artifact.id))
      setSelectedKeys(
        (current) =>
          new Set([...current].filter((key) => !deletedKeys.has(key)))
      )
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : 'Could not delete the selected named views.'
      )
    } finally {
      setIsChangingSource(false)
    }
  }

  const renameView = async (view: KclNamedView) => {
    const name = draftName.trim()
    setEditingKey(null)
    if (name === '' || name === view.artifact.name) return

    setIsChangingSource(true)
    const oldActive = activeViewSignal.peek()
    const wasActive = isSameView(
      { name: view.artifact.name, moduleKey: moduleKeyOf(view.modulePath) },
      oldActive
    )
    try {
      const wasmInstance = await kclManager.wasmInstancePromise
      const modifiedAst = renameNamedView({
        ast: kclManager.ast,
        pathToNode: view.artifact.codeRef.pathToNode,
        name,
        wasmInstance,
      })
      if (isErr(modifiedAst)) {
        toast.error(modifiedAst.message)
        return
      }

      if (wasActive) {
        activeViewSignal.value = {
          name,
          moduleKey: moduleKeyOf(view.modulePath),
        }
      }
      await updateModelingState(modifiedAst, EXECUTION_TYPE_REAL, kclManager)
    } catch (reason) {
      if (wasActive) activeViewSignal.value = oldActive
      toast.error(
        reason instanceof Error
          ? reason.message
          : `Could not rename “${view.artifact.name}”.`
      )
    } finally {
      setIsChangingSource(false)
    }
  }

  const updateViewCamera = async (view: KclNamedView) => {
    const camera = captureNamedViewCamera(kclManager.sceneInfra)
    if (isErr(camera)) {
      toast.error(camera.message)
      return
    }

    setIsChangingSource(true)
    try {
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
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : `Could not update “${view.artifact.name}”.`
      )
    } finally {
      setIsChangingSource(false)
    }
  }

  const selectedViews = rows.flatMap((row) => {
    if (
      !selectedKeys.has(row.key) ||
      lockedKeys.has(row.key) ||
      row.target.kind !== 'declared' ||
      !canManageNamedView(row.target.view)
    ) {
      return []
    }
    return [row.target.view]
  })

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
          <div className="flex items-center gap-1">
            <PaneIconButton
              icon="plus"
              label="Create named view"
              testId="named-view-create"
              disabled={actionsDisabled}
              onClick={() => {
                app.commands.actor.send({
                  type: 'Find and select command',
                  data: { name: 'Named View', groupId: 'modeling' },
                })
              }}
            />
            <PaneIconButton
              icon="trash"
              label="Delete selected named views"
              testId="named-view-delete-selected"
              disabled={actionsDisabled || selectedViews.length === 0}
              onClick={() => void deleteViews(selectedViews)}
            />
          </div>
        }
        onClose={props.onClose}
      />
      <section className="overflow-auto pb-8">
        <ul className="py-0.5" aria-label="Named views">
          {rows.map((row, index) => {
            const manageableView =
              row.target.kind === 'declared' &&
              canManageNamedView(row.target.view)
                ? row.target.view
                : undefined
            const isActive = isSameView(row.identity, active)
            const isSelected = selectedKeys.has(row.key)
            const isLocked = lockedKeys.has(row.key)
            const rowActionsDisabled = actionsDisabled || isLocked
            const selectRow = (shiftKey: boolean, toggleKey: boolean) => {
              const selection = nextViewSelection({
                selected: selectedKeys,
                rowKey: row.key,
                rowIndex: index,
                anchorIndex: selectionAnchor,
                rowKeys,
                shiftKey,
                toggleKey,
              })
              setSelectedKeys(selection.selected)
              setSelectionAnchor(selection.anchorIndex)
            }

            return (
              <li
                key={row.key}
                className={`group flex h-7 min-w-0 select-none items-center gap-1 px-1 text-sm ${
                  isSelected
                    ? 'bg-chalkboard-20 dark:bg-chalkboard-80'
                    : 'hover:bg-chalkboard-10 dark:hover:bg-chalkboard-90'
                }`}
                data-testid="named-view-row"
                data-active={isActive}
                data-selected={isSelected}
              >
                <span
                  data-testid="named-view-number"
                  className="w-5 shrink-0 text-right text-xs tabular-nums text-chalkboard-60 dark:text-chalkboard-50"
                >
                  {index + 1}
                </span>
                <button
                  type="button"
                  className="grid h-6 w-6 shrink-0 place-items-center text-chalkboard-70 hover:text-primary disabled:cursor-default disabled:opacity-50 dark:text-chalkboard-30"
                  aria-label={
                    isActive ? `${row.label} is active` : `Apply ${row.label}`
                  }
                  aria-pressed={isActive}
                  disabled={actionsDisabled}
                  onClick={() => {
                    if (isActive) return
                    activateNamedView({
                      target: row.target,
                      kclManager,
                    }).catch(reportRejection)
                  }}
                >
                  <ViewStateIcon active={isActive} />
                </button>
                {editingKey === row.key && manageableView ? (
                  <input
                    autoFocus
                    type="text"
                    value={draftName}
                    aria-label={`Rename ${manageableView.artifact.name}`}
                    data-testid="named-view-rename"
                    className="min-w-0 flex-1 rounded-sm bg-transparent px-1 outline outline-1 outline-primary focus:ring-0"
                    onChange={(event) => setDraftName(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        event.currentTarget.blur()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelRenameRef.current = true
                        event.currentTarget.blur()
                      }
                    }}
                    onBlur={() => {
                      if (cancelRenameRef.current) {
                        cancelRenameRef.current = false
                        setEditingKey(null)
                        return
                      }
                      void renameView(manageableView)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-baseline gap-2 self-stretch text-left"
                    aria-pressed={isSelected}
                    onClick={(event) =>
                      selectRow(event.shiftKey, event.metaKey || event.ctrlKey)
                    }
                    onDoubleClick={(event) => {
                      if (!manageableView || rowActionsDisabled) return
                      event.preventDefault()
                      cancelRenameRef.current = false
                      setDraftName(manageableView.artifact.name)
                      setEditingKey(row.key)
                    }}
                  >
                    <span
                      data-testid="named-view-label"
                      className="shrink-0 truncate"
                    >
                      {row.label}
                    </span>
                    {row.detail ? (
                      <span className="min-w-0 truncate text-xs text-chalkboard-60 dark:text-chalkboard-50">
                        <span aria-hidden className="mr-2">
                          |
                        </span>
                        {row.detail}
                      </span>
                    ) : null}
                  </button>
                )}
                {manageableView ? (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <PaneIconButton
                      icon={isLocked ? 'lockClosed' : 'lockOpen'}
                      label={isLocked ? 'Unlock named view' : 'Lock named view'}
                      testId="named-view-lock"
                      disabled={actionsDisabled}
                      onClick={() => {
                        setLockedKeys((current) => {
                          const next = new Set(current)
                          if (next.has(row.key)) next.delete(row.key)
                          else next.add(row.key)
                          return next
                        })
                      }}
                    />
                    <CameraUpdateButton
                      disabled={rowActionsDisabled}
                      onClick={() => void updateViewCamera(manageableView)}
                    />
                    <NamedViewRowMenu
                      disabled={rowActionsDisabled}
                      onEdit={() => editView(manageableView)}
                      onDelete={() => void deleteViews([manageableView])}
                    />
                  </div>
                ) : row.target.kind === 'declared' ? (
                  <CustomIcon
                    name="lockClosed"
                    className="mx-1 h-4 w-4 shrink-0 text-chalkboard-50"
                    aria-label="Imported named view is read only"
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

function ViewStateIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden>
      <path
        d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      {active ? (
        <>
          <path
            d="M5.2 10s1.8-3 4.8-3 4.8 3 4.8 3-1.8 3-4.8 3-4.8-3-4.8-3Z"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <circle cx="10" cy="10" r="1.5" fill="currentColor" />
        </>
      ) : null}
    </svg>
  )
}

function PaneIconButton({
  icon,
  label,
  testId,
  disabled,
  onClick,
}: {
  icon: 'plus' | 'trash' | 'lockClosed' | 'lockOpen'
  label: string
  testId: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <ActionButton
      Element="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      disabled={disabled}
      tabIndex={0}
      iconStart={{
        icon,
        iconClassName: '!text-current',
        bgClassName: 'bg-transparent dark:bg-transparent',
      }}
      className="!p-0 !bg-transparent hover:text-primary border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 !outline-none disabled:opacity-40"
      onClick={onClick}
    />
  )
}

function CameraUpdateButton({
  disabled,
  onClick,
}: {
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label="Update from current camera"
      title="Update from current camera"
      data-testid="named-view-update-camera"
      disabled={disabled}
      className="relative grid h-6 w-6 place-items-center rounded-sm text-chalkboard-70 hover:text-primary disabled:opacity-35 dark:text-chalkboard-30"
      onClick={onClick}
    >
      <CustomIcon name="camera" className="h-5 w-5" aria-hidden />
      <span
        aria-hidden
        className="absolute -right-0.5 -top-0.5 grid h-2.5 w-2.5 place-items-center rounded-full bg-chalkboard-10 text-[9px] font-bold leading-none dark:bg-chalkboard-90"
      >
        +
      </span>
    </button>
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
