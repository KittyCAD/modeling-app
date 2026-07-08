import { Registry } from '@kittycad/registry'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import {
  keymapScopesValueSpec,
  keymapValueSpec,
  matchKeymapKeystrokes,
} from '@src/registry/contracts/keymap'
import {
  MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE,
  markdownEditorService,
} from '@src/registry/contracts/markdownEditor'
import { defaultKeymapItem } from '@src/registry/extensions/keymap/defaultKeymap'
import { describe, expect, it, vi } from 'vitest'
import markdownEditorExtension, { MARKDOWN_EDITOR_COMMAND_IDS } from '.'

describe('markdown editor extension', () => {
  it('routes Mod+K to the focused Markdown editor link action', () => {
    const registry = new Registry()
    registry.configure([defaultKeymapItem, markdownEditorExtension])

    const command = registry
      .get(commandsValueSpec)
      .find((candidate) => candidate.id === MARKDOWN_EDITOR_COMMAND_IDS.setLink)
    const tree = registry.get(keymapValueSpec)
    const keymapScopes = registry.get(keymapScopesValueSpec)
    const baseMatch = matchKeymapKeystrokes(tree, [], ['mod+k'], keymapScopes)
    const markdownEditorMatch = matchKeymapKeystrokes(
      tree,
      [MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE],
      ['mod+k'],
      keymapScopes
    )

    expect(baseMatch).toMatchObject({
      type: 'full',
      item: { command: 'zds.commandPalette.open' },
    })
    expect(markdownEditorMatch).toMatchObject({
      type: 'full',
      item: { command: MARKDOWN_EDITOR_COMMAND_IDS.setLink },
    })

    if (!command) {
      throw new Error('Missing Markdown editor link command')
    }

    const service = registry.get(markdownEditorService)
    const setLink = vi.fn(() => true)
    const unregister = service.registerActiveEditor({ setLink })

    expect(command.onSubmit()).toBe(true)
    expect(setLink).toHaveBeenCalledTimes(1)

    unregister()

    expect(command.onSubmit()).toBe(false)

    registry[Symbol.dispose]()
  })
})
