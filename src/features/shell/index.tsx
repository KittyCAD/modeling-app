import { defineRegistryItem, provide } from '@kittycad/registry'
import { Button, Logo } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { commandService } from '@src/contracts/commands'
import { projectSessionService } from '@src/contracts/projectSession'
import { runtimeService } from '@src/contracts/runtime'
import { Crumbs } from '@src/features/shell/Crumbs'
import {
  topBarItemsValueSpec,
  statusBarItemsValueSpec,
} from '@src/contracts/shell'
import './shell.css'

/**
 * The app's identity, and the way home.
 *
 * The logotype spells "Zoo", so the button beside it says only what this
 * particular Zoo application is. Both are one control: clicking either closes
 * the project, which is what "go home" means when home is a state rather than a
 * route.
 */
function Brand() {
  const session = useService(projectSessionService)

  return (
    <button
      class="zds-brand"
      type="button"
      onClick={() => session.close()}
      title="Close the project and go home"
    >
      <Logo label="Zoo" />
      <span class="zds-brand__name">Design Studio</span>
    </button>
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
