import { useSignals } from '@preact/signals-react/runtime'
import type { ModulePath } from '@rust/kcl-lib/bindings/ModulePath'

import { ActionButton } from '@src/components/ActionButton'
import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useReliesOnEngine } from '@src/hooks/useReliesOnEngine'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import { listNamedViews } from '@src/lang/std/kclNamedViews'
import { ROOT_MODULE_ID } from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG, FILE_EXT } from '@src/lib/constants'
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
import { prepareNamedViewEditCommand } from '@src/lib/kclNamedViewEdit'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { isErr, reportRejection } from '@src/lib/trap'
import { getKclDefaultViewName } from '@src/lib/wasm_lib_wrapper'
import type { RefObject } from 'react'
import { useRef, useState } from 'react'
import toast from 'react-hot-toast'

export type ViewRow = {
  /** Unique per row, so React keys stay stable across executions. */
  key: string
  /** What the user reads. */
  label: string
  /** What `activeViewSignal` holds when this row is active. */
  identity: ActiveView | null
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
      label: getKclDefaultViewName(),
      identity: null,
      target: { kind: 'kclDefault' },
    },
    ...declared,
  ]
}

export function KclNamedViewsPane(props: AreaTypeComponentProps) {
  useSignals()
  const app = useApp()
  const canManageViews = app.userFeatures.useHas(
    EXPERIMENTAL_POINT_AND_CLICK_FLAG,
    false
  )
  const { kclManager } = useSingletons()
  const [isChangingSource, setIsChangingSource] = useState(false)
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
  const actionsDisabled = cannotReachEngine || inSketchMode || isChangingSource

  const editView = (view: KclNamedView) => {
    const ast = kclManager.ast
    const code = kclManager.code
    const path = kclManager.path
    const projectPath = kclManager.systemDeps.project.value?.path
    const sourceIsCurrent = () =>
      ast === kclManager.ast &&
      code === kclManager.code &&
      path === kclManager.path &&
      projectPath === kclManager.systemDeps.project.value?.path
    const artifact = execState.artifactGraph.get(view.artifact.id)
    if (artifact?.type !== 'namedView') {
      toast.error(`Could not find “${view.artifact.name}”.`)
      return
    }
    prepareNamedViewEditCommand({
      artifact,
      ast,
      code,
      artifactGraph: execState.artifactGraph,
      rustContext: kclManager.rustContext,
    })
      .then((event) => {
        if (!sourceIsCurrent()) return
        if (isErr(event)) {
          toast.error(event.message)
          return
        }
        app.commands.actor.send(event)
      })
      .catch((reason) => {
        if (!sourceIsCurrent()) return
        toast.error(
          reason instanceof Error
            ? reason.message
            : `Could not edit “${view.artifact.name}”.`
        )
      })
  }

  const removeView = async (view: KclNamedView) => {
    const artifact = kclManager.execState.artifactGraph.get(view.artifact.id)
    if (artifact?.type !== 'namedView') {
      toast.error(`Could not find “${view.artifact.name}”.`)
      return
    }
    setIsChangingSource(true)
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
    } finally {
      setIsChangingSource(false)
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

            return (
              <li
                key={row.key}
                className="group flex h-7 min-w-0 select-none items-center gap-1 px-1 text-sm hover:bg-chalkboard-10 focus-within:bg-chalkboard-20 dark:hover:bg-chalkboard-90 dark:focus-within:bg-chalkboard-80"
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
                  className="reset grid h-6 w-6 shrink-0 place-items-center text-chalkboard-70 hover:text-primary disabled:cursor-default disabled:opacity-50 dark:text-chalkboard-30"
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
                    name={isActive ? 'eyeOpen' : 'namedView'}
                    className="h-5 w-5"
                    aria-hidden
                  />
                </button>
                <button
                  type="button"
                  className="reset flex min-w-0 flex-1 items-center gap-2 self-stretch text-left !text-xs"
                  onDoubleClick={(event) => {
                    if (!manageableView || actionsDisabled) return
                    event.preventDefault()
                    editView(manageableView)
                  }}
                >
                  <span
                    data-testid="named-view-label"
                    className="shrink-0 truncate"
                  >
                    {row.label}
                  </span>
                </button>
                {manageableView ? (
                  <NamedViewRowMenu
                    disabled={actionsDisabled}
                    onEdit={() => editView(manageableView)}
                    onRemove={() => void removeView(manageableView)}
                  />
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

function PaneIconButton({
  buttonRef,
  icon,
  label,
  testId,
  disabled,
  onClick,
}: {
  buttonRef?: RefObject<HTMLButtonElement | null>
  icon: 'plus' | 'three-dots'
  label: string
  testId: string
  disabled: boolean
  onClick?: () => void
}) {
  return (
    <ActionButton
      ref={buttonRef}
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
      className="h-6 w-6 shrink-0 justify-center !p-0 !bg-transparent hover:text-primary border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 !outline-none disabled:opacity-40"
      onClick={onClick}
    />
  )
}

function NamedViewRowMenu({
  disabled,
  onEdit,
  onRemove,
}: {
  disabled: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <PaneIconButton
        buttonRef={triggerRef}
        icon="three-dots"
        label="Named view actions"
        testId="named-view-actions"
        disabled={disabled}
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
            key="remove"
            data-testid="named-view-remove"
            onClick={onRemove}
            disabled={disabled}
          >
            Remove
          </ContextMenuItem>,
        ]}
      />
    </>
  )
}
