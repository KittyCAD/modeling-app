import { defineRegistryItem, provide } from '@kittycad/registry'
import { createElement, type ChangeEvent, type MouseEvent } from 'react'
import { useSelector } from '@xstate/react'
import { Toggle } from '@src/components/Toggle/Toggle'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import type { CodeEditorHeaderItemProps } from '@src/registry/contracts/codeEditor'
import { codeEditorHeaderItemsValueSpec } from '@src/registry/contracts/codeEditor'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { reportRejection } from '@src/lib/trap'

type BooleanSettingSnapshot = {
  current: boolean
}

function useAutoexecuteSetting() {
  const settingsActor = window.app.settings.actor
  const enabled = useSelector(settingsActor, (state) => {
    const textEditorSettings = state.context.textEditor as Record<
      string,
      BooleanSettingSnapshot
    >
    return textEditorSettings.autoexecute.current
  })

  return { enabled, settingsActor }
}

function AutoexecuteHeaderItem({ className }: CodeEditorHeaderItemProps) {
  const { enabled, settingsActor } = useAutoexecuteSetting()

  return createElement(
    'div',
    {
      className,
      title: 'Automatic execution',
      onClick: (event: MouseEvent<HTMLDivElement>) => event.stopPropagation(),
    },
    createElement('span', null, 'Auto'),
    createElement(Toggle, {
      name: 'code-editor-autoexecute',
      checked: enabled,
      offLabel: '',
      onLabel: '',
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        settingsActor.send({
          type: 'set.textEditor.autoexecute',
          data: {
            level: 'user',
            value: event.target.checked,
          },
        } as never)
      },
      className: 'flex-none',
    })
  )
}

function ExecuteHeaderItem({ className }: CodeEditorHeaderItemProps) {
  const { enabled } = useAutoexecuteSetting()

  if (enabled) {
    return null
  }

  return createElement(
    'button',
    {
      type: 'button',
      className,
      title: 'Execute code',
      onClick: () => {
        window.kclManager.executeCode().catch(reportRejection)
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
      id: 'code-editor.autoexecute',
      order: 10,
      Component: AutoexecuteHeaderItem,
    }),
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
