import { defineRegistryItem, provide } from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import { getAutomaticallyRenderEnabledFromSettings } from '@src/lib/automaticRendering'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import { reportRejection } from '@src/lib/trap'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import {
  type KeymapDocument,
  MODE_MODELING_KEYMAP_SCOPE,
  MODE_SKETCHING_KEYMAP_SCOPE,
  MODE_SKETCH_NO_FACE_KEYMAP_SCOPE,
  MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
  keymapValueSpec,
} from '@src/registry/contracts/keymap'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { APP_COMMAND_IDS } from '@src/registry/extensions/commands/appCommands'
import { useSelector } from '@xstate/react'
import { createElement } from 'react'

const RENDER_HOTKEY = 'mod+s'
const CODE_EDITOR_KEYMAP_SOURCE = 'code-editor'

const codeEditorKeymap: KeymapDocument = {
  source: CODE_EDITOR_KEYMAP_SOURCE,
  bindings: [
    {
      id: 'code-editor.render',
      title: 'Render code',
      scopes: [
        MODE_MODELING_KEYMAP_SCOPE,
        MODE_SKETCHING_KEYMAP_SCOPE,
        MODE_SKETCH_NO_FACE_KEYMAP_SCOPE,
        MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
      ],
      keystrokes: [RENDER_HOTKEY],
      command: APP_COMMAND_IDS.editor.render,
    },
  ],
}

function RenderHeaderItem({ app }: AppHeaderItemProps) {
  useSignals()
  const platform = usePlatform()
  const currentProject = app.projectSignal.value
  const automaticallyRenderEnabled = useSelector(app.settings.actor, (state) =>
    getAutomaticallyRenderEnabledFromSettings(state.context)
  )
  const executionService = app.registry.signal(executingEditorService).value
  const hasEditsSinceLastExecution =
    executionService?.hasEditsSinceLastExecution.value ?? false
  const keymap = app.registry.optional(keymapService)
  const renderHotkeyLabel = keymapKeystrokesDisplay(
    keymap
      ? findKeymapItemForCommand(
          keymap.keymap.value,
          APP_COMMAND_IDS.editor.render,
          keymap.getCurrentScopes(),
          app.registry.signal(keymapScopesValueSpec).value
        )?.keystrokes
      : [RENDER_HOTKEY],
    platform
  )

  if (!currentProject || automaticallyRenderEnabled || !executionService) {
    return null
  }

  const tooltipText = hasEditsSinceLastExecution ? 'Render' : 'Up to date'
  const iconName = hasEditsSinceLastExecution ? 'play' : 'checkmark'
  const buttonClassName = `flex gap-1 items-center justify-center py-0 px-0.5 m-0 text-primary dark:text-inherit bg-chalkboard-10/80 dark:bg-chalkboard-100/50 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-100 border border-solid border-primary/50 hover:border-primary active:border-primary ${
    hasEditsSinceLastExecution
      ? '!border-primary !bg-primary/10 !text-primary dark:!bg-primary/20 dark:!text-primary'
      : 'disabled:cursor-default disabled:opacity-70 disabled:hover:border-primary/50'
  }`

  return createElement(
    'span',
    { className: 'inline-flex items-center' },
    createElement(
      'button',
      {
        type: 'button',
        className: buttonClassName,
        disabled: !hasEditsSinceLastExecution,
        'aria-label': tooltipText,
        onClick: () => {
          executionService.executeCode().catch(reportRejection)
        },
      },
      createElement(CustomIcon, {
        name: iconName,
        className: 'w-5 h-5',
        'aria-hidden': true,
      })
    ),
    createElement(
      Tooltip,
      {
        position: 'bottom-right',
        hoverOnly: true,
        contentClassName: 'text-sm whitespace-nowrap flex items-center gap-3',
      },
      createElement('span', null, tooltipText),
      hasEditsSinceLastExecution && renderHotkeyLabel
        ? createElement(
            'kbd',
            { className: 'hotkey tooltip' },
            renderHotkeyLabel
          )
        : null
    )
  )
}

const codeEditorSettingsItem = defineRegistryItem({
  provides: [
    provide(settingsValueSpec, {
      textEditor: {
        automaticallyRender: defineBooleanExtensionSetting({
          defaultValue: true,
          description:
            'Whether the code editor should automatically render changes.',
          hideOnLevel: 'project',
          commandConfig: {
            inputType: 'boolean',
          },
          userToml: {
            sectionKey: 'text_editor',
            tomlKey: 'automatically_render',
          },
        }),
      },
    }),
  ],
})

const renderHeaderItem = defineRegistryItem({
  provides: [
    provide(keymapValueSpec, codeEditorKeymap, {
      key: codeEditorKeymap.source,
    }),
    provide(appHeaderItemsValueSpec, {
      id: 'code-editor.render',
      order: 5,
      Component: RenderHeaderItem,
    }),
  ],
})

const codeEditor = createZdsPlugin({
  id: 'code-editor',
  title: 'Code editor',
  description: 'Code editor settings and behavior.',
  items: [codeEditorSettingsItem, renderHeaderItem],
  defaultSetting: 'core',
})

export default codeEditor
