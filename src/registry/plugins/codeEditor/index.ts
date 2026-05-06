import { defineRegistryItem, provide } from '@kittycad/registry'
import { createElement } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import { useHotkeys } from 'react-hotkeys-hook'
import { useSelector } from '@xstate/react'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { reportRejection } from '@src/lib/trap'
import { executingEditorService } from '@src/registry/contracts/executingEditor'

type BooleanSettingSnapshot = {
  current: boolean
}

const RENDER_HOTKEY = 'mod+enter'

function RenderHeaderItem({ app, className }: AppHeaderItemProps) {
  useSignals()
  const platform = usePlatform()
  const currentProject = app.projectSignal.value
  const enabled = useSelector(app.settings.actor, (state) => {
    const textEditorSettings = state.context.textEditor as Record<
      string,
      BooleanSettingSnapshot
    >
    return textEditorSettings.automaticallyRender.current
  })
  const executionService = app.registry.signal(executingEditorService).value
  const hasEditsSinceLastExecution =
    executionService?.hasEditsSinceLastExecution.value ?? false
  const renderHotkeyLabel = hotkeyDisplay(RENDER_HOTKEY, platform)?.replace(
    'enter',
    'Enter'
  )

  useHotkeys(
    RENDER_HOTKEY,
    (event) => {
      event.preventDefault()
      if (!hasEditsSinceLastExecution) {
        return
      }
      executionService?.executeCode().catch(reportRejection)
    },
    {
      enabled: !enabled && !!executionService,
      preventDefault: true,
    },
    [executionService, hasEditsSinceLastExecution]
  )

  if (!currentProject || enabled || !executionService) {
    return null
  }

  const tooltipText = hasEditsSinceLastExecution ? 'Render' : 'Up to date'
  const iconName = hasEditsSinceLastExecution ? 'play' : 'checkmark'
  const buttonClassName = `${className} !p-0 !w-7 justify-center ${
    hasEditsSinceLastExecution
      ? '!border-primary !bg-primary/10 !text-primary dark:!bg-primary/20 dark:!text-primary'
      : 'disabled:!text-chalkboard-60 dark:disabled:!text-chalkboard-50 !border-transparent'
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
    provide(appHeaderItemsValueSpec, {
      id: 'code-editor.render',
      order: 20,
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
