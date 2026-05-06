import { defineRegistryItem, provide } from '@kittycad/registry'
import { createElement } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import { useSelector } from '@xstate/react'
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

  const buttonClassName = hasEditsSinceLastExecution
    ? `${className} !border-primary !bg-primary/10 dark:!bg-primary/20`
    : className

  return createElement(
    'button',
    {
      type: 'button',
      className: buttonClassName,
      title: 'Execute code',
      onClick: () => {
        executionService.executeCode().catch(reportRejection)
      },
    },
    createElement('span', null, 'Execute')
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
