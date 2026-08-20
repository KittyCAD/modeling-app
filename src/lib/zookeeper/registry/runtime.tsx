import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { AreaType, type AreaTypeComponentProps } from '@src/lib/layout/types'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { layoutAreaLibraryValueSpec } from '@src/registry/contracts/layout'
import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const ZookeeperConversationPaneWrapper = lazy(async () => {
  const { ZookeeperConversationPaneWrapper } = await import(
    '@src/lib/zookeeper/components/ZookeeperConversationPaneWrapper'
  )
  return { default: ZookeeperConversationPaneWrapper }
})

type ZookeeperPortalRuntime = ReturnType<typeof createZookeeperPortalRuntime>

export function createZookeeperPortalRuntime() {
  const paneNode = signal<HTMLDivElement | undefined>(undefined)
  const paneProps = signal<AreaTypeComponentProps | undefined>(undefined)
  let portalHost: HTMLDivElement | undefined
  let disposed = false

  return {
    paneNode,
    paneProps,
    attachPane(node: HTMLDivElement) {
      if (disposed) {
        return () => undefined
      }

      paneNode.value = node
      if (portalHost) {
        node.append(portalHost)
      }

      return () => {
        if (paneNode.peek() !== node) {
          return
        }
        paneNode.value = undefined
        portalHost?.remove()
      }
    },
    updatePaneProps(props: AreaTypeComponentProps) {
      if (!disposed) {
        paneProps.value = props
      }
    },
    getPortalHost() {
      if (!portalHost) {
        portalHost = document.createElement('div')
        portalHost.className = 'flex flex-1 min-w-0 min-h-0'
        portalHost.dataset.zookeeperRuntimeHost = ''
        if (paneNode.peek()) {
          paneNode.peek()?.append(portalHost)
        }
      }
      return portalHost
    },
    dispose() {
      disposed = true
      paneNode.value = undefined
      paneProps.value = undefined
      portalHost?.remove()
      portalHost = undefined
    },
  }
}

function ZookeeperPaneOutlet({
  areaConfig,
  layout,
  onClose,
  runtime,
}: AreaTypeComponentProps & { runtime: ZookeeperPortalRuntime }) {
  const outletRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const outlet = outletRef.current
    if (!outlet) {
      return
    }
    return runtime.attachPane(outlet)
  }, [runtime])

  useLayoutEffect(() => {
    runtime.updatePaneProps({ areaConfig, layout, onClose })
  }, [areaConfig, layout, onClose, runtime])

  return <div ref={outletRef} className="flex flex-1 min-w-0 min-h-0" />
}

function ZookeeperPortalHost({
  app,
  runtime,
}: AppHeaderItemProps & { runtime: ZookeeperPortalRuntime }) {
  useSignals()
  const token = app.auth.useToken()
  const project = app.project?.projectIORefSignal.value
  const projectPath = project?.path
  const [scope, setScope] = useState<
    { apiToken: string; projectPath: string } | undefined
  >()
  const paneIsAttached = runtime.paneNode.value !== undefined
  const paneProps = runtime.paneProps.value
  const [portalHost] = useState(() => runtime.getPortalHost())
  const scopeMatchesCurrentProject =
    scope !== undefined &&
    scope.projectPath === projectPath &&
    scope.apiToken === token

  useLayoutEffect(() => {
    if (!projectPath || !token) {
      setScope(undefined)
      return
    }

    setScope((previous) => {
      const matches =
        previous?.projectPath === projectPath && previous.apiToken === token
      if (matches || (!paneIsAttached && previous === undefined)) {
        return previous
      }
      if (!paneIsAttached) {
        return undefined
      }
      return {
        apiToken: token,
        projectPath,
      }
    })
  }, [paneIsAttached, projectPath, token])

  if (!scopeMatchesCurrentProject || !scope || !paneProps || !project) {
    return null
  }

  return createPortal(
    <Suspense fallback={null}>
      <ZookeeperConversationPaneWrapper
        {...paneProps}
        isPaneVisible={paneIsAttached}
        theProject={project}
      />
    </Suspense>,
    portalHost,
    `zookeeper-session-${scope.projectPath}`
  )
}

export const zookeeperPaneRuntimeRegistryItem = defineRegistryItemFactory(
  () => {
    const runtime = createZookeeperPortalRuntime()

    const PaneOutlet = (props: AreaTypeComponentProps) => (
      <ZookeeperPaneOutlet {...props} runtime={runtime} />
    )
    const PortalHost = (props: AppHeaderItemProps) => (
      <ZookeeperPortalHost {...props} runtime={runtime} />
    )

    return {
      item: defineRuntimeRegistryItem({
        id: 'zookeeper.pane-runtime',
        provides: [
          provide(layoutAreaLibraryValueSpec, {
            [AreaType.Zookeeper]: {
              hide: () => false,
              shortcut: 'Ctrl + T',
              cssClassOverrides: {
                button:
                  'bg-ml-green pressed:bg-transparent dark:!text-chalkboard-100 hover:dark:!text-inherit dark:pressed:!text-inherit',
              },
              Component: PaneOutlet,
            },
          }),
          provide(
            appHeaderItemsValueSpec,
            {
              id: 'zookeeper.runtime-host',
              order: 1000,
              Component: PortalHost,
            },
            { key: 'zookeeper.runtime-host' }
          ),
        ],
        dispose: () => runtime.dispose(),
      }),
    }
  },
  'zookeeper.pane-runtime'
)
