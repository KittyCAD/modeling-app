import { defineRegistryItem, provide } from '@kittycad/registry'
import { useComputed } from '@preact/signals'
import { Button } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { commandService } from '@src/contracts/commands'
import { projectSessionService } from '@src/contracts/projectSession'
import { runtimeService } from '@src/contracts/runtime'
import {
  topBarItemsValueSpec,
  statusBarItemsValueSpec,
} from '@src/contracts/shell'
import './shell.css'

function Brand() {
  const session = useService(projectSessionService)

  return (
    <div class="zds-brand">
      <span class="zds-brand__mark" aria-hidden="true" />
      <button
        class="zds-brand__name"
        type="button"
        onClick={() => session.close()}
      >
        Design Studio
      </button>
    </div>
  )
}

/**
 * What is open, in mono, project then file.
 *
 * A readout rather than navigation. The only action on it goes home, because
 * that is the only place "up" can mean here.
 */
function Crumbs() {
  const session = useService(projectSessionService)

  const project = useComputed(
    () => session.current.value?.project.value ?? null
  )
  const buffer = useComputed(
    () => session.current.value?.activeBuffer.value ?? null
  )

  if (!project.value) return null

  return (
    <nav class="zds-crumbs" aria-label="Open project">
      <span class="zds-crumbs__project">{project.value.name}</span>
      {buffer.value ? (
        <>
          <span class="zds-crumbs__separator" aria-hidden="true">
            /
          </span>
          <span class="zds-crumbs__file">{buffer.value.name}</span>
          {buffer.value.dirty.value ? (
            <span class="zds-crumbs__dirty" title="Unsaved changes">
              ●
            </span>
          ) : null}
        </>
      ) : null}
    </nav>
  )
}

function PaletteButton() {
  const commands = useService(commandService)

  return (
    <Button
      variant="chassis"
      icon="command"
      label="Commands"
      shortcut="⌘K"
      onClick={() => commands.run('palette.open')}
    />
  )
}

function VersionField() {
  const runtime = useService(runtimeService)

  return (
    <span class="zds-status-field">
      <span class="zds-status-field__name">{runtime.info.value.target}</span>
      <span class="zds-status-field__value">{runtime.info.value.version}</span>
    </span>
  )
}

/**
 * The chassis's own contributions.
 *
 * Everything the frame itself needs and nothing else. Features add their own
 * items; the shell does not curate them.
 */
export default defineRegistryItem({
  id: 'shell',
  provides: [
    provide(topBarItemsValueSpec, {
      id: 'shell.brand',
      zone: 'start',
      order: 0,
      render: () => <Brand />,
    }),
    provide(topBarItemsValueSpec, {
      id: 'shell.crumbs',
      zone: 'center',
      order: 0,
      render: () => <Crumbs />,
    }),
    provide(topBarItemsValueSpec, {
      id: 'shell.palette',
      zone: 'end',
      order: 100,
      render: () => <PaletteButton />,
    }),
    provide(statusBarItemsValueSpec, {
      id: 'shell.version',
      zone: 'end',
      order: 100,
      render: () => <VersionField />,
    }),
  ],
})
