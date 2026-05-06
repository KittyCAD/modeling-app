import { defineRegistryItem, provide } from '@kittycad/registry'
import { createElement } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import { useSelector } from '@xstate/react'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import type { CodeEditorHeaderItemProps } from '@src/registry/contracts/codeEditor'
import { codeEditorHeaderItemsValueSpec } from '@src/registry/contracts/codeEditor'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { reportRejection } from '@src/lib/trap'
import { executingEditorService } from '@src/registry/contracts/executingEditor'

type BooleanSettingSnapshot = {
  current: boolean
}

function ExecuteHeaderItem({ app, className }: CodeEditorHeaderItemProps) {
  useSignals()
  const enabled = useSelector(app.settings.actor, (state) => {
    const textEditorSettings = state.context.textEditor as Record<
      string,
      BooleanSettingSnapshot
    >
    return textEditorSettings.autoexecute.current
  })
  const executionService = app.registry.signal(executingEditorService).value
  const hasEditsSinceLastExecution =
    executionService?.hasEditsSinceLastExecution.value ?? false

  if (enabled || !executionService) {
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
        contentClassName: 'text-sm whitespace-nowrap',
      },
      tooltipText
    )
  )
}

const codeEditorSettingsItem = defineRegistryItem({
  provides: [
    provide(settingsValueSpec, {
      textEditor: {
        autoexecute: defineBooleanExtensionSetting({
          defaultValue: true,
          description: 'Whether the code editor should autoexecute changes.',
          hideOnLevel: 'project',
          commandConfig: {
            inputType: 'boolean',
          },
          userToml: {
            sectionKey: 'text_editor',
            tomlKey: 'autoexecute',
          },
        }),
      },
    }),
  ],
})

const codeEditorHeaderItem = defineRegistryItem({
  provides: [
    provide(codeEditorHeaderItemsValueSpec, {
      id: 'code-editor.execute',
      order: 20,
      Component: ExecuteHeaderItem,
    }),
  ],
})

const codeEditor = createZdsPlugin({
  id: 'code-editor',
  title: 'Code editor',
  description: 'Code editor settings and behavior.',
  items: [codeEditorSettingsItem, codeEditorHeaderItem],
  defaultSetting: 'core',
})

export default codeEditor
