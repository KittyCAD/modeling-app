import { Disclosure } from '@headlessui/react'
import type { NamedView } from '@rust/kcl-lib/bindings/NamedView'
import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import { CustomIcon } from '@src/components/CustomIcon'
import { RowItemWithIconMenuAndToggle } from '@src/components/RowItemWithIconMenuAndToggle'
import Tooltip from '@src/components/Tooltip'
import { useApp } from '@src/lib/boot'
import type { CommandBarMachineEvent } from '@src/machines/commandBarMachine'
import { useRef } from 'react'
import toast from 'react-hot-toast'

type NamedViewEntry = [string, NamedView]

const namedViewsGroupId = 'namedViews'

function commandEvent(
  name: string,
  argDefaultValues?: Record<string, unknown>
): CommandBarMachineEvent {
  return {
    type: 'Find and select command',
    data: {
      name,
      groupId: namedViewsGroupId,
      argDefaultValues,
    },
  }
}

export function AnnotationViewsFeatureTreeSection() {
  const headerMenuRef = useRef<HTMLDivElement>(null)
  const { commands, settings } = useApp()
  const namedViews = settings.useSettings().app.namedViews.current
  const entries = Object.entries(namedViews).toSorted(([, a], [, b]) =>
    a.name.localeCompare(b.name)
  )

  return (
    <Disclosure defaultOpen>
      <div ref={headerMenuRef}>
        <Disclosure.Button className="reset w-full min-w-[0px] !px-1 flex items-center gap-2 text-left text-base !border-transparent focus-within:bg-primary/25 hover:!bg-2 hover:focus-within:bg-primary/25">
          <CustomIcon
            name="caretDown"
            className="w-6 h-6 block self-start -rotate-90 ui-open:rotate-0 ui-open:transform"
            aria-hidden
          />
          <CustomIcon name="eyeOpen" className="w-4 h-4" aria-hidden />
          <span className="text-sm flex-1">Named Views</span>
        </Disclosure.Button>
        <ContextMenu
          menuTargetElement={headerMenuRef}
          items={[
            <ContextMenuItem
              key="create-named-view"
              data-testid="named-view-create"
              onClick={() => {
                commands.send(commandEvent('Create named view'))
              }}
            >
              Add named view
            </ContextMenuItem>,
          ]}
        />
      </div>
      <Disclosure.Panel>
        <NamedViewsList entries={entries} />
      </Disclosure.Panel>
    </Disclosure>
  )
}

function NamedViewsList({ entries }: { entries: NamedViewEntry[] }) {
  if (entries.length === 0) {
    return (
      <section className="overflow-auto mr-1 pb-2">
        <ul>
          <li className="px-3 py-1 text-xs text-chalkboard-60 dark:text-chalkboard-50">
            No named views
          </li>
        </ul>
      </section>
    )
  }

  return (
    <section className="overflow-auto mr-1 pb-2">
      <ul>
        {entries.map(([id, view]) => (
          <NamedViewItem key={id} id={id} view={view} />
        ))}
      </ul>
    </section>
  )
}

function NamedViewItem({ id, view }: { id: string; view: NamedView }) {
  const { commands, settings } = useApp()
  const namedViews = settings.useSettings().app.namedViews.current
  const showAnnotations = view.show_annotations ?? true

  const openNamedViewCommand = (name: string) => {
    commands.send(commandEvent(name, { name: id }))
  }

  const editNamedView = () => {
    commands.send(
      commandEvent('Edit named view', {
        name: id,
        newName: view.name,
        show_annotations: showAnnotations,
      })
    )
  }

  const toggleShowAnnotations = () => {
    const current = settings.actor.getSnapshot().context.app.namedViews.current
    const currentView = current[id]
    if (!currentView) {
      toast.error('Unable to update, could not find the named view.')
      return
    }

    settings.actor.send({
      type: 'set.app.namedViews',
      data: {
        level: 'project',
        value: {
          ...current,
          [id]: {
            ...currentView,
            show_annotations: !(currentView.show_annotations ?? true),
          },
        },
        toastCallback: () => {
          toast.success(`Named view ${currentView.name} updated.`)
        },
      },
    })
  }

  return (
    <li className="px-1 py-0.5">
      <RowItemWithIconMenuAndToggle
        icon="eyeOpen"
        onClick={() => openNamedViewCommand('Load named view')}
        menuItems={[
          <ContextMenuItem
            key="load"
            data-testid="named-view-load"
            onClick={() => openNamedViewCommand('Load named view')}
          >
            Load named view
          </ContextMenuItem>,
          <ContextMenuItem
            key="create"
            data-testid="named-view-create"
            onClick={() => commands.send(commandEvent('Create named view'))}
          >
            Add named view
          </ContextMenuItem>,
          <ContextMenuItem
            key="edit"
            data-testid="named-view-edit"
            onClick={editNamedView}
          >
            Edit named view
          </ContextMenuItem>,
          <ContextMenuItem
            key="delete"
            data-testid="named-view-delete"
            disabled={namedViews[id] === undefined}
            onClick={() => openNamedViewCommand('Delete named view')}
          >
            Delete named view
          </ContextMenuItem>,
        ]}
        Toggle={
          <button
            type="button"
            className="reset relative flex w-7 h-7 items-center justify-center rounded-sm hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80"
            onClick={(event) => {
              event.stopPropagation()
              toggleShowAnnotations()
            }}
            aria-label={
              showAnnotations
                ? 'Hide annotations for this named view'
                : 'Show annotations for this named view'
            }
          >
            <CustomIcon
              name={showAnnotations ? 'eyeOpen' : 'eyeCrossedOut'}
              className="w-4 h-4"
              aria-hidden
            />
            <Tooltip position="left">
              {showAnnotations
                ? 'Shows annotations when loaded'
                : 'Hides annotations when loaded'}
            </Tooltip>
          </button>
        }
      >
        {view.name}
      </RowItemWithIconMenuAndToggle>
    </li>
  )
}
