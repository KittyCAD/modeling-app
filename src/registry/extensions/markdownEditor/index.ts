import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import type { MarkdownEditorActions } from '@kittycad/ui-components'
import type { Command } from '@src/lib/commandTypes'
import { provideCommand } from '@src/registry/contracts/commands'
import {
  type KeymapItem,
  provideKeymapItem,
  provideKeymapScope,
} from '@src/registry/contracts/keymap'
import {
  MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE,
  type MarkdownEditorService,
  markdownEditorService,
} from '@src/registry/contracts/markdownEditor'

const MARKDOWN_EDITOR_COMMAND_GROUP_ID = 'markdownEditor'
const MARKDOWN_EDITOR_KEYMAP_SOURCE = 'Markdown editor'

export const MARKDOWN_EDITOR_COMMAND_IDS = Object.freeze({
  setLink: 'zds.markdownEditor.setLink',
} as const)

const setLinkKeymapItem: KeymapItem = {
  id: 'markdown-editor.link',
  title: 'Edit Markdown link',
  source: MARKDOWN_EDITOR_KEYMAP_SOURCE,
  scopes: [MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE],
  keystrokes: ['mod+k'],
  command: MARKDOWN_EDITOR_COMMAND_IDS.setLink,
}

const markdownEditorExtension = defineRegistryItemFactory(() => {
  let nextRegistrationId = 0
  const activeEditors: {
    id: number
    actions: MarkdownEditorActions
  }[] = []

  const runLinkAction = () => activeEditors.at(-1)?.actions.setLink() ?? false

  const serviceImpl: MarkdownEditorService = {
    registerActiveEditor: (actions) => {
      const registration = {
        id: nextRegistrationId,
        actions,
      }
      nextRegistrationId += 1
      activeEditors.push(registration)

      return () => {
        const index = activeEditors.findIndex(
          (candidate) => candidate.id === registration.id
        )
        if (index !== -1) {
          activeEditors.splice(index, 1)
        }
      }
    },
  }

  const setLinkCommand: Command = {
    id: MARKDOWN_EDITOR_COMMAND_IDS.setLink,
    name: MARKDOWN_EDITOR_COMMAND_IDS.setLink,
    groupId: MARKDOWN_EDITOR_COMMAND_GROUP_ID,
    displayName: 'Edit Markdown link',
    description: 'Add or edit a link in the focused Markdown editor.',
    hideFromSearch: true,
    needsReview: false,
    onSubmit: runLinkAction,
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'markdown-editor-extension',
      provides: [
        provideCommand(setLinkCommand),
        provideKeymapItem(setLinkKeymapItem),
        provideKeymapScope({
          id: MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE,
          displayName: 'Markdown editor focused',
          priority: 1200,
          userEditable: false,
        }),
      ],
      providesServices: [provideService(markdownEditorService, serviceImpl)],
    }),
  }
}, 'markdown-editor-extension')

export default markdownEditorExtension
