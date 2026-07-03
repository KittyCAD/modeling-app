import {
  Registry,
  defineRegistryItem,
  pluginsValueSpec,
  provideService,
} from '@kittycad/registry'
import { DefaultLayoutToolbarID } from '@src/lib/layout/configs/default'
import {
  type CommandSystemService,
  commandSystemService,
  commandsValueSpec,
} from '@src/registry/contracts/commands'
import {
  layoutActionLibraryValueSpec,
  layoutContributionsValueSpec,
} from '@src/registry/contracts/layout'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import {
  EXPORT_TO_SLICER_ACTION_TYPE,
  EXPORT_TO_SLICER_COMMAND_GROUP_ID,
  EXPORT_TO_SLICER_COMMAND_ID,
  EXPORT_TO_SLICER_COMMAND_NAME,
  SLICER_PLUGIN_ID,
} from '@src/registry/plugins/slicer/constants'
import { describe, expect, it, vi } from 'vitest'
import slicer from '.'

function createCommandSystemService(send: CommandSystemService['send']) {
  return {
    actor: {} as CommandSystemService['actor'],
    send,
    useState: vi.fn(),
  } satisfies CommandSystemService
}

describe('slicer plugin', () => {
  it('registers a toggleable Export to Slicer command and toolbar action', () => {
    const send = vi.fn()
    const commandSystemItem = defineRegistryItem({
      id: 'test-command-system-service',
      providesServices: [
        provideService(commandSystemService, createCommandSystemService(send)),
      ],
    })
    const registry = new Registry()
    registry.configure([commandSystemItem, slicer])

    const [plugin] = registry.get(pluginsValueSpec)
    expect(plugin).toMatchObject({
      id: SLICER_PLUGIN_ID,
      title: 'Slicer export',
    })

    const toggle = registry.get(plugin.service)
    expect(toggle.active.value).toBe(false)
    expect(
      registry.get(settingsValueSpec).plugins[SLICER_PLUGIN_ID].createSetting()
        .default
    ).toBe(false)

    expect(registry.get(commandsValueSpec)).toEqual([])
    expect(registry.get(layoutActionLibraryValueSpec)).toEqual({})
    expect(registry.get(layoutContributionsValueSpec)).toEqual([])

    toggle.enable()

    const [command] = registry.get(commandsValueSpec)
    expect(command).toMatchObject({
      id: EXPORT_TO_SLICER_COMMAND_ID,
      name: EXPORT_TO_SLICER_COMMAND_NAME,
      displayName: EXPORT_TO_SLICER_COMMAND_NAME,
      groupId: EXPORT_TO_SLICER_COMMAND_GROUP_ID,
      icon: 'printer3d',
      hide: 'web',
      needsReview: false,
    })
    expect(command.args?.slicer).toMatchObject({
      displayName: 'Slicer',
      inputType: 'options',
      required: true,
      options: [
        { name: 'PrusaSlicer', value: 'prusa-slicer', isCurrent: true },
        { name: 'Cura', value: 'cura' },
      ],
    })
    expect(command.args?.slicer.valueSummary?.('cura')).toBe('Cura')

    const actionLibrary = registry.get(layoutActionLibraryValueSpec)
    expect(actionLibrary).toHaveProperty(EXPORT_TO_SLICER_ACTION_TYPE)
    actionLibrary[EXPORT_TO_SLICER_ACTION_TYPE].execute()
    expect(send).toHaveBeenCalledWith({
      type: 'Find and select command',
      data: {
        name: EXPORT_TO_SLICER_COMMAND_NAME,
        groupId: EXPORT_TO_SLICER_COMMAND_GROUP_ID,
      },
    })

    expect(registry.get(layoutContributionsValueSpec)).toEqual([
      expect.objectContaining({
        id: 'slicer.left-toolbar.action',
        kind: 'action',
        action: expect.objectContaining({
          id: 'export-to-slicer',
          label: EXPORT_TO_SLICER_COMMAND_NAME,
          icon: 'printer3d',
          actionType: EXPORT_TO_SLICER_ACTION_TYPE,
        }),
        placement: {
          targetPaneId: DefaultLayoutToolbarID.Left,
          position: 'end',
        },
      }),
    ])

    toggle.disable()

    expect(toggle.active.value).toBe(false)
    expect(registry.get(commandsValueSpec)).toEqual([])
    expect(registry.get(layoutActionLibraryValueSpec)).toEqual({})
    expect(registry.get(layoutContributionsValueSpec)).toEqual([])
  })
})
