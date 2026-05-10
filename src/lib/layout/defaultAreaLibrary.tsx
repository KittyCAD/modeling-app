import { useApp, useSingletons } from '@src/lib/boot'
import type { AreaLibrary, AreaTypeDefinition } from '@src/lib/layout/types'
import { kclErrorsByFilename } from '@src/lang/errors'
import type { MouseEventHandler } from 'react'
import { useCallback, useMemo } from 'react'
import { togglePaneLayoutNode } from '@src/lib/layout/utils'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import { ProjectExplorerPane } from '@src/components/layout/areas/ProjectExplorerPane'
import { KclEditorPane } from '@src/components/layout/areas/KclEditorPane'
import { MlEphantConversationPaneWrapper } from '@src/components/layout/areas/MlEphantConversationPaneWrapper'
import { FeatureTreePane } from '@src/components/layout/areas/FeatureTreePane'
import { MemoryPane } from '@src/components/layout/areas/MemoryPane'
import { LogsPane } from '@src/components/layout/areas/LoggingPanes'
import { DebugPane } from '@src/components/layout/areas/DebugPane'
import { BodiesPane } from '@src/components/layout/areas/BodiesPane'
import { useSignals } from '@preact/signals-react/runtime'
import { layoutAreaLibraryValueSpec } from '@src/registry/contracts/layout'

export const useDefaultAreaLibrary = () => {
  useSignals()
  const { settings, layout, registry } = useApp()
  const { kclManager } = useSingletons()
  const getSettings = settings.get
  const registeredAreaLibrary = registry.signal(
    layoutAreaLibraryValueSpec
  ).value
  const onCodeNotificationClick: MouseEventHandler = useCallback(
    (e) => {
      e.preventDefault()
      const rootLayout = structuredClone(layout.signal.value)
      layout.set(
        togglePaneLayoutNode({
          rootLayout,
          targetNodeId: DefaultLayoutPaneID.Code,
          shouldExpand: true,
        })
      )
      kclManager.scrollToFirstErrorDiagnosticIfExists()
    },
    [kclManager, layout]
  )

  return useMemo(
    () =>
      Object.freeze({
        featureTree: {
          hide: () => false,
          shortcut: 'Shift + T',
          Component: FeatureTreePane,
        },
        bodies: {
          hide: () => false,
          Component: BodiesPane,
        },
        ttc: {
          hide: () => false,
          shortcut: 'Ctrl + T',
          cssClassOverrides: {
            button:
              'bg-ml-green pressed:bg-transparent dark:!text-chalkboard-100 hover:dark:!text-inherit dark:pressed:!text-inherit',
          },
          Component: MlEphantConversationPaneWrapper,
        },
        codeEditor: {
          hide: () => false,
          shortcut: 'Shift + C',
          Component: KclEditorPane,
          useNotifications() {
            const value = kclManager.diagnosticsSignal.value.filter(
              (diagnostic) => diagnostic.severity === 'error'
            ).length
            return useMemo(() => {
              return {
                value,
                onClick: onCodeNotificationClick,
                title: undefined,
              }
            }, [value])
          },
        },
        files: {
          hide: () => false,
          shortcut: 'Shift + F',
          Component: ProjectExplorerPane,
          useNotifications() {
            const title = 'Project files have runtime errors'
            // Only compute runtime errors! Compilation errors are not tracked here.
            const errors = kclErrorsByFilename(kclManager.errorsSignal.value)
            const value = errors.size > 0 ? 'x' : ''
            const onClick: MouseEventHandler = (e) => {
              e.preventDefault()
              // TODO: When we have generic file open
              // If badge is pressed
              // Open the first error in the array of errors
              // Then scroll to error
              // Do you automatically open the project files
              // kclManager.scrollToFirstErrorDiagnosticIfExists()
            }
            return useMemo(() => ({ value, onClick, title }), [value, title])
          },
        },
        variables: {
          hide: () => false,
          shortcut: 'Shift + V',
          Component: MemoryPane,
        },
        logs: {
          hide: () => false,
          shortcut: 'Shift + L',
          Component: LogsPane,
        },
        debug: {
          hide: () => getSettings().debug.showPanel.current === false,
          shortcut: 'Shift + D',
          Component: DebugPane,
        },
        ...registeredAreaLibrary,
      } satisfies AreaLibrary),
    [getSettings, kclManager, onCodeNotificationClick, registeredAreaLibrary]
  )
}

function testArea(name: string): AreaTypeDefinition {
  return {
    hide: () => false,
    Component: () => (
      <div className="self-stretch flex-1 grid place-content-center">
        {name}
      </div>
    ),
  }
}

export const testAreaLibrary = Object.freeze({
  featureTree: testArea('Feature Tree'),
  bodies: testArea('bodies'),
  modeling: testArea('Modeling Scene'),
  ttc: testArea('TTC'),
  codeEditor: testArea('Code Editor'),
  files: testArea('File Explorer'),
  logs: testArea('Logs'),
  variables: testArea('Variables'),
  debug: testArea('Debug'),
} satisfies AreaLibrary)
