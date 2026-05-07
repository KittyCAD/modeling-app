import { defineRegistryItem, provide } from '@kittycad/registry'
import { createElement } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import { useSelector } from '@xstate/react'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { reportRejection } from '@src/lib/trap'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import toast from 'react-hot-toast'
import { getAutomaticallyRenderEnabledFromSettings } from '@src/lib/automaticRendering'

const RENDER_HOTKEY = 'mod+s'

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
  const renderHotkeyLabel = hotkeyDisplay(RENDER_HOTKEY, platform)

  useHotkeyWrapper(
    [RENDER_HOTKEY],
    () => {
      if (
        !automaticallyRenderEnabled &&
        hasEditsSinceLastExecution &&
        executionService
      ) {
        executionService.executeCode().catch(reportRejection)
        return
      }

      toast.success('Your work is auto-saved in real-time.')
    },
    app.singletons.kclManager,
    {
      enabled: !!currentProject,
      registerToCodeMirror: !!currentProject,
    }
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
