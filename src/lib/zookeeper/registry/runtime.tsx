import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { AreaType, type AreaTypeComponentProps } from '@src/lib/layout/types'
import type {
  createZookeeperManagerActor,
  stopZookeeperManagerActor,
  ZookeeperManagerActor,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import { zookeeperPromptRunningSignal } from '@src/lib/zookeeper/zookeeperPromptState'
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

type ZookeeperRuntime = ReturnType<typeof createZookeeperRuntime>

type ZookeeperSessionScope = Readonly<{
  apiToken: string
  projectPath: string
}>

type ZookeeperSession = Readonly<{
  actor: ZookeeperManagerActor
  generation: number
  isCurrent: () => boolean
  scope: ZookeeperSessionScope
}>

type ZookeeperHostLease = Readonly<{
  scope: ZookeeperSessionScope | undefined
}>

type ZookeeperSessionActivation = {
  generation: number
  scope: ZookeeperSessionScope
  stop?: () => void
}

type ZookeeperManagerModule = {
  createZookeeperManagerActor: typeof createZookeeperManagerActor
  stopZookeeperManagerActor: typeof stopZookeeperManagerActor
}

const loadZookeeperManager = (): Promise<ZookeeperManagerModule> =>
  import('@src/lib/zookeeper/zookeeperManagerMachine')

function scopesMatch(
  left: ZookeeperSessionScope | undefined,
  right: ZookeeperSessionScope | undefined
) {
  return (
    left?.apiToken === right?.apiToken &&
    left?.projectPath === right?.projectPath
  )
}

// The registry owns the actor and transport. The portal remains a temporary
// bridge for the React-based file, history, reconnect, queue, and billing hooks.
export function createZookeeperRuntime(
  loadManager: () => Promise<ZookeeperManagerModule> = loadZookeeperManager
) {
  const paneNode = signal<HTMLDivElement | undefined>(undefined)
  const paneProps = signal<AreaTypeComponentProps | undefined>(undefined)
  const session = signal<ZookeeperSession | undefined>(undefined)
  let portalHost: HTMLDivElement | undefined
  let hostLease: ZookeeperHostLease | undefined
  let activation: ZookeeperSessionActivation | undefined
  let nextSessionGeneration = 0
  let disposed = false

  const deactivate = () => {
    const previousActivation = activation
    activation = undefined
    session.value = undefined
    previousActivation?.stop?.()
  }

  const setSessionScope = async (scope: ZookeeperSessionScope | undefined) => {
    if (disposed || scopesMatch(activation?.scope, scope)) {
      return
    }

    deactivate()
    if (!scope) {
      return
    }
    const nextActivation: ZookeeperSessionActivation = {
      generation: ++nextSessionGeneration,
      scope,
    }
    activation = nextActivation

    try {
      const manager = await loadManager()
      if (disposed || activation !== nextActivation) {
        return
      }

      const actor = manager.createZookeeperManagerActor(scope.apiToken)
      nextActivation.stop = () => manager.stopZookeeperManagerActor(actor)
      session.value = {
        actor,
        generation: nextActivation.generation,
        isCurrent: () =>
          !disposed && hostLease !== undefined && activation === nextActivation,
        scope,
      }
    } catch (error: unknown) {
      if (disposed || activation !== nextActivation) {
        return
      }
      activation = undefined
      console.error('Failed to start the Zookeeper session.', error)
    }
  }

  const reconcileSession = () => {
    if (!hostLease) {
      return
    }
    const scope = hostLease.scope
    if (!scope) {
      void setSessionScope(undefined)
      return
    }
    if (paneNode.peek()) {
      void setSessionScope(scope)
      return
    }
    // A closed pane may retain its session, but never starts one for a new scope.
    if (!scopesMatch(activation?.scope, scope)) {
      void setSessionScope(undefined)
    }
  }

  return {
    paneNode,
    paneProps,
    session,
    attachHost(scope: ZookeeperSessionScope | undefined) {
      if (disposed) {
        return () => undefined
      }

      const lease = { scope }
      hostLease = lease
      reconcileSession()

      return () => {
        if (disposed || hostLease !== lease) {
          return
        }
        hostLease = undefined

        // Preserve the session when React replaces the host in the same turn.
        queueMicrotask(() => {
          if (disposed || hostLease) {
            return
          }
          void setSessionScope(undefined)
        })
      }
    },
    attachPane(node: HTMLDivElement) {
      if (disposed) {
        return () => undefined
      }

      paneNode.value = node
      if (portalHost) {
        node.append(portalHost)
      }
      reconcileSession()

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
        paneNode.peek()?.append(portalHost)
      }
      return portalHost
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      hostLease = undefined
      deactivate()
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
}: AreaTypeComponentProps & { runtime: ZookeeperRuntime }) {
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
}: AppHeaderItemProps & { runtime: ZookeeperRuntime }) {
  useSignals()
  const token = app.auth.useToken()
  const project = app.project?.projectIORefSignal.value
  const projectPath = project?.path
  const paneIsAttached = runtime.paneNode.value !== undefined
  const paneProps = runtime.paneProps.value
  const session = runtime.session.value
  const [portalHost] = useState(() => runtime.getPortalHost())

  useLayoutEffect(
    () =>
      runtime.attachHost(
        projectPath && token ? { apiToken: token, projectPath } : undefined
      ),
    [projectPath, runtime, token]
  )

  if (
    !session ||
    session.scope.projectPath !== projectPath ||
    session.scope.apiToken !== token ||
    !paneProps ||
    !project
  ) {
    return null
  }

  return createPortal(
    <Suspense fallback={null}>
      <ZookeeperConversationPaneWrapper
        {...paneProps}
        isPaneVisible={paneIsAttached}
        isSessionCurrent={session.isCurrent}
        theProject={project}
        zookeeperManagerActor={session.actor}
      />
    </Suspense>,
    portalHost,
    `zookeeper-session-${session.generation}`
  )
}

export const zookeeperPaneRuntimeRegistryItem = defineRegistryItemFactory(
  () => {
    const runtime = createZookeeperRuntime()

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
              getIcon(isOpen) {
                return !isOpen && zookeeperPromptRunningSignal.value
                  ? 'loading'
                  : undefined
              },
              Component: PaneOutlet,
            },
          }),
          provide(
            appHeaderItemsValueSpec,
            {
              id: 'zookeeper.runtime-host',
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
