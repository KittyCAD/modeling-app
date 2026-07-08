import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import type {
  MarkdownEditorActionName,
  MarkdownEditorActions,
} from '@kittycad/ui-components'
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
  toggleBold: 'zds.markdownEditor.toggleBold',
  toggleItalic: 'zds.markdownEditor.toggleItalic',
  setLink: 'zds.markdownEditor.setLink',
  toggleBulletList: 'zds.markdownEditor.toggleBulletList',
  toggleOrderedList: 'zds.markdownEditor.toggleOrderedList',
  undo: 'zds.markdownEditor.undo',
  redo: 'zds.markdownEditor.redo',
} as const)

type MarkdownEditorCommandId =
  (typeof MARKDOWN_EDITOR_COMMAND_IDS)[keyof typeof MARKDOWN_EDITOR_COMMAND_IDS]

type MarkdownEditorKeymapDefinition = {
  id: string
  title: string
  command: MarkdownEditorCommandId
  action: MarkdownEditorActionName
  keystrokes: readonly string[]
  hidden?: boolean
  userBindingCommand?: MarkdownEditorCommandId
}

const markdownEditorKeymaps: readonly MarkdownEditorKeymapDefinition[] = [
  {
    id: 'markdown-editor.bold',
    title: 'Toggle Markdown bold',
    command: MARKDOWN_EDITOR_COMMAND_IDS.toggleBold,
    action: 'toggleBold',
    keystrokes: ['mod+b'],
  },
  {
    id: 'markdown-editor.bold-shift',
    title: 'Toggle Markdown bold',
    command: MARKDOWN_EDITOR_COMMAND_IDS.toggleBold,
    action: 'toggleBold',
    keystrokes: ['mod+shift+b'],
    hidden: true,
    userBindingCommand: MARKDOWN_EDITOR_COMMAND_IDS.toggleBold,
  },
  {
    id: 'markdown-editor.italic',
    title: 'Toggle Markdown italic',
    command: MARKDOWN_EDITOR_COMMAND_IDS.toggleItalic,
    action: 'toggleItalic',
    keystrokes: ['mod+i'],
  },
  {
    id: 'markdown-editor.italic-shift',
    title: 'Toggle Markdown italic',
    command: MARKDOWN_EDITOR_COMMAND_IDS.toggleItalic,
    action: 'toggleItalic',
    keystrokes: ['mod+shift+i'],
    hidden: true,
    userBindingCommand: MARKDOWN_EDITOR_COMMAND_IDS.toggleItalic,
  },
  {
    id: 'markdown-editor.link',
    title: 'Edit Markdown link',
    command: MARKDOWN_EDITOR_COMMAND_IDS.setLink,
    action: 'setLink',
    keystrokes: ['mod+k'],
  },
  {
    id: 'markdown-editor.bullet-list',
    title: 'Toggle Markdown bullet list',
    command: MARKDOWN_EDITOR_COMMAND_IDS.toggleBulletList,
    action: 'toggleBulletList',
    keystrokes: ['mod+shift+8'],
  },
  {
    id: 'markdown-editor.bullet-list-asterisk',
    title: 'Toggle Markdown bullet list',
    command: MARKDOWN_EDITOR_COMMAND_IDS.toggleBulletList,
    action: 'toggleBulletList',
    keystrokes: ['mod+shift+*'],
    hidden: true,
    userBindingCommand: MARKDOWN_EDITOR_COMMAND_IDS.toggleBulletList,
  },
  {
    id: 'markdown-editor.ordered-list',
    title: 'Toggle Markdown numbered list',
    command: MARKDOWN_EDITOR_COMMAND_IDS.toggleOrderedList,
    action: 'toggleOrderedList',
    keystrokes: ['mod+shift+7'],
  },
  {
    id: 'markdown-editor.ordered-list-ampersand',
    title: 'Toggle Markdown numbered list',
    command: MARKDOWN_EDITOR_COMMAND_IDS.toggleOrderedList,
    action: 'toggleOrderedList',
    keystrokes: ['mod+shift+&'],
    hidden: true,
    userBindingCommand: MARKDOWN_EDITOR_COMMAND_IDS.toggleOrderedList,
  },
  {
    id: 'markdown-editor.undo',
    title: 'Undo Markdown edit',
    command: MARKDOWN_EDITOR_COMMAND_IDS.undo,
    action: 'undo',
    keystrokes: ['mod+z'],
  },
  {
    id: 'markdown-editor.undo-russian',
    title: 'Undo Markdown edit',
    command: MARKDOWN_EDITOR_COMMAND_IDS.undo,
    action: 'undo',
    keystrokes: ['mod+я'],
    hidden: true,
    userBindingCommand: MARKDOWN_EDITOR_COMMAND_IDS.undo,
  },
  {
    id: 'markdown-editor.redo',
    title: 'Redo Markdown edit',
    command: MARKDOWN_EDITOR_COMMAND_IDS.redo,
    action: 'redo',
    keystrokes: ['mod+shift+z'],
  },
  {
    id: 'markdown-editor.redo-y',
    title: 'Redo Markdown edit',
    command: MARKDOWN_EDITOR_COMMAND_IDS.redo,
    action: 'redo',
    keystrokes: ['mod+y'],
    hidden: true,
    userBindingCommand: MARKDOWN_EDITOR_COMMAND_IDS.redo,
  },
  {
    id: 'markdown-editor.redo-russian',
    title: 'Redo Markdown edit',
    command: MARKDOWN_EDITOR_COMMAND_IDS.redo,
    action: 'redo',
    keystrokes: ['mod+shift+я'],
    hidden: true,
    userBindingCommand: MARKDOWN_EDITOR_COMMAND_IDS.redo,
  },
]

const markdownEditorKeymapItems: readonly KeymapItem[] =
  markdownEditorKeymaps.map((keymap) => ({
    id: keymap.id,
    title: keymap.title,
    source: MARKDOWN_EDITOR_KEYMAP_SOURCE,
    scopes: [MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE],
    keystrokes: keymap.keystrokes,
    command: keymap.command,
    hidden: keymap.hidden,
    userBindingCommand: keymap.userBindingCommand,
  }))

const markdownEditorCommands: readonly Command[] = Object.values(
  MARKDOWN_EDITOR_COMMAND_IDS
).map((commandId) => {
  const keymap = markdownEditorKeymaps.find(
    (candidate) => candidate.command === commandId
  )

  return {
    id: commandId,
    name: commandId,
    groupId: MARKDOWN_EDITOR_COMMAND_GROUP_ID,
    displayName: keymap?.title ?? commandId,
    description: 'Run an action in the focused Markdown editor.',
    hideFromSearch: true,
    needsReview: false,
    onSubmit: () => false,
  }
})

const markdownEditorExtension = defineRegistryItemFactory(() => {
  let nextRegistrationId = 0
  const activeEditors: {
    id: number
    actions: MarkdownEditorActions
  }[] = []

  const runEditorAction = (action: MarkdownEditorActionName) =>
    activeEditors.at(-1)?.actions[action]() ?? false

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

  const commands: readonly Command[] = markdownEditorCommands.map((command) => {
    const keymap = markdownEditorKeymaps.find(
      (candidate) => candidate.command === command.id
    )

    return {
      ...command,
      onSubmit: () => (keymap ? runEditorAction(keymap.action) : false),
    }
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'markdown-editor-extension',
      provides: [
        ...commands.map(provideCommand),
        ...markdownEditorKeymapItems.map(provideKeymapItem),
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
