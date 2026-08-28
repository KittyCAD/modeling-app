import { Button, Menu } from '@kittycad/ui-kit'
import { useComputed } from '@preact/signals'
import { useService, useValueSpec } from '@src/app/context'
import type { Command } from '@src/contracts/commands'
import { commandService } from '@src/contracts/commands'
import { keybindingService } from '@src/contracts/keybindings'
import {
  sceneModeService,
  toolbarItemsValueSpec,
} from '@src/contracts/sceneModes'
import type {
  ResolvedEntry,
  ResolvedGroup,
} from '@src/features/sceneToolbar/resolveToolbar'
import { resolveToolbar } from '@src/features/sceneToolbar/resolveToolbar'
import './sceneToolbar.css'

/**
 * Which mode the scene is in, and how to change it.
 *
 * A dropdown rather than a row of buttons. The modes are mutually exclusive and
 * there will be more of them than fit next to the tools — spending three buttons
 * on a one-of-three choice takes room from the thing the toolbar is for, and the
 * active mode is the only one worth showing at rest.
 *
 * A mode that cannot be entered stays listed and disabled with its reason: a mode
 * that vanishes teaches nobody that it exists, which matters most for the one
 * that appears when you are somewhere specific.
 */
function ModeSwitcher() {
  const modes = useService(sceneModeService)
  const keys = useService(keybindingService)

  const active = modes.active.value
  if (!active) return null

  return (
    <Menu
      align="start"
      label="Scene mode"
      sections={[
        {
          id: 'modes',
          label: 'Mode',
          items: modes.modes.value.map((mode) => {
            const { available, reason } = modes.availability(mode.id)

            return {
              id: mode.id,
              label: mode.title,
              icon: mode.icon,
              // The reason takes the shortcut's place on a mode you cannot
              // enter: which key would have worked is not the useful answer.
              shortcut: available
                ? keys.displayFor(`scene.mode.${mode.id}`)
                : (reason ?? 'Not available here'),
              disabled: !available,
              onSelect: () => modes.enter(mode.id),
            }
          }),
        },
      ]}
      trigger={({ open, toggle, ref }) => (
        <Button
          variant="ghost"
          size="small"
          icon={active.icon}
          iconEnd="chevronDown"
          label={active.title}
          pressed={open}
          elementRef={ref}
          onClick={toggle}
        />
      )}
    />
  )
}

/** One command, as a button that knows nothing about the command it runs. */
function CommandButton({
  command,
  onRun,
}: {
  command: Command
  onRun?: () => void
}) {
  const commands = useService(commandService)
  const keys = useService(keybindingService)

  return (
    <Button
      variant="ghost"
      size="small"
      label={command.title}
      icon={command.icon}
      disabled={!(command.enabled?.value ?? true)}
      shortcut={keys.displayFor(command.id)}
      onClick={() => {
        onRun?.()
        commands.run(command.id)
      }}
    />
  )
}

/**
 * A group: the last used command on the face, the rest behind a caret.
 *
 * The face runs directly rather than opening the menu, which is what makes the
 * tool you keep reaching for a single click. Using anything from the menu moves
 * it to the face — recorded through the service so it survives the toolbar being
 * re-rendered, which it is on every mode change and every execution.
 */
function GroupButton({ group }: { group: ResolvedGroup }) {
  const commands = useService(commandService)
  const keys = useService(keybindingService)
  const modes = useService(sceneModeService)

  return (
    <div class="zds-scene-toolbar__group">
      <CommandButton
        command={group.face}
        onRun={() => modes.noteUsed(group.id, group.face.id)}
      />
      <Menu
        align="start"
        label={group.title}
        sections={[
          {
            id: group.id,
            label: group.title,
            items: group.commands.map((command) => ({
              id: command.id,
              label: command.title,
              icon: command.icon,
              shortcut: keys.displayFor(command.id),
              disabled: !(command.enabled?.value ?? true),
              onSelect: () => {
                modes.noteUsed(group.id, command.id)
                commands.run(command.id)
              },
            })),
          },
        ]}
        trigger={({ open, toggle, ref }) => (
          <Button
            variant="ghost"
            size="small"
            icon="chevronDown"
            iconOnly
            label={`More ${group.title.toLowerCase()} tools`}
            pressed={open}
            elementRef={ref}
            onClick={toggle}
          />
        )}
      />
    </div>
  )
}

const Entry = ({ entry }: { entry: ResolvedEntry }) =>
  entry.kind === 'group' ? (
    <GroupButton group={entry} />
  ) : (
    <CommandButton command={entry.command} />
  )

/**
 * The tools for the mode the scene is in.
 *
 * Holds no list of tools and no knowledge of what modelling is. Every button is
 * a contributed item naming a command, every rule is a change of section, and
 * what to draw is decided by `resolveToolbar` — so this file does not change when
 * a tool, a group, or a whole mode is added.
 */
export function SceneToolbar() {
  const modes = useService(sceneModeService)
  const commands = useService(commandService)
  const items = useValueSpec(toolbarItemsValueSpec)

  const sections = useComputed(() =>
    resolveToolbar({
      items: items.value,
      mode: modes.active.value?.id ?? null,
      commandFor: (id) => commands.get(id),
      lastUsed: modes.lastUsed.value,
    })
  )

  const mode = modes.active.value
  if (!mode) return null

  return (
    <div class="zds-scene-toolbar" data-mode={mode.id}>
      <ModeSwitcher />

      {sections.value.length === 0 ? (
        <span class="zds-scene-toolbar__empty">
          {mode.empty ?? `No ${mode.title.toLowerCase()} tools yet.`}
        </span>
      ) : (
        sections.value.map((section) => (
          <div class="zds-scene-toolbar__section" key={section.id}>
            {section.entries.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </div>
        ))
      )}
    </div>
  )
}
