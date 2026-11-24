import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createCameraViewMenuItems } from '@src/components/CameraViewMenu'
import {
  cameraShortcutHints,
  createCameraKeymapItems,
} from '@src/lib/cameraViewCommands'
import { createStandardViewsCommands } from '@src/lib/commandBarConfigs/standardViewsConfig'
import {
  DEFAULT_COMMAND_SCOPES,
  MODE_MODELING_COMMAND_SCOPE,
} from '@src/registry/contracts/commands'
import {
  createKeymapTree,
  resolveKeymapItems,
  KEYMAP_SCHEMA_VERSION,
} from '@src/registry/contracts/keymap'

it.each(['legacy', 'modeling'] as const)(
  'shows effective camera sequences and removes unbound hints in the %s menu',
  (type) => {
    const scope =
      type === 'legacy' ? MODE_MODELING_COMMAND_SCOPE : 'test.modeling-focused'
    const host = type === 'legacy' ? { type } : { type, scope }
    const defaults = createCameraKeymapItems(host)
    const frontCommand =
      type === 'legacy' ? 'standardViews:Front view' : 'kcl.camera.front'
    const camera = {
      updateCameraToAxis: vi.fn(async () => {}),
      zoomToFit: vi.fn(async () => {}),
    }
    const renderItems = (tree: ReturnType<typeof createKeymapTree>) => (
      <>
        {createCameraViewMenuItems({
          camera,
          reset: async () => {},
          center: async () => {},
          shortcuts: cameraShortcutHints(
            tree,
            host,
            [scope],
            DEFAULT_COMMAND_SCOPES
          ),
        })}
      </>
    )
    const view = render(renderItems(createKeymapTree(defaults)))
    expect(
      screen.getByRole('button', { name: /Front view/ })
    ).toHaveTextContent('V 3')
    expect(screen.getByRole('button', { name: /Back view/ })).toHaveTextContent(
      'V 4'
    )
    fireEvent.click(screen.getByRole('button', { name: /Front view/ }))
    expect(camera.updateCameraToAxis).toHaveBeenCalledWith('-y')

    const rebound = resolveKeymapItems(defaults, {
      version: KEYMAP_SCHEMA_VERSION,
      bindings: [
        { command: frontCommand, when: [scope], keystrokes: ['v', '9'] },
      ],
    })
    view.rerender(renderItems(createKeymapTree(rebound)))
    expect(
      screen.getByRole('button', { name: /Front view/ })
    ).toHaveTextContent('V 9')
    expect(
      screen.getByRole('button', { name: /Front view/ })
    ).not.toHaveTextContent('V 3')

    const unbound = resolveKeymapItems(defaults, {
      version: KEYMAP_SCHEMA_VERSION,
      bindings: [
        { command: `-${frontCommand}`, when: [scope], keystrokes: ['v', '3'] },
      ],
    })
    view.rerender(renderItems(createKeymapTree(unbound)))
    expect(
      screen.getByRole('button', { name: /Front view/ })
    ).toHaveTextContent(/^Front view$/)
  }
)

it('keeps the legacy command IDs and axis directions paired with their sequences', () => {
  const camera = {
    updateCameraToAxis: vi.fn(async () => {}),
    zoomToFit: vi.fn(async () => {}),
  }
  const commands = createStandardViewsCommands(camera)
  const expected = [
    ['Top view', 'z'],
    ['Right view', 'x'],
    ['Front view', '-y'],
    ['Back view', 'y'],
    ['Bottom view', '-z'],
    ['Left view', '-x'],
  ] as const
  for (const [name, axis] of expected) {
    const command = commands.find((command) => command.name === name)
    expect(command?.groupId).toBe('standardViews')
    command?.onSubmit()
    expect(camera.updateCameraToAxis).toHaveBeenLastCalledWith(axis)
  }
})
