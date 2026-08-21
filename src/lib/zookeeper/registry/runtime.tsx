import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { AreaType, type AreaTypeComponentProps } from '@src/lib/layout/types'
import type { ZookeeperManagerActor } from '@src/lib/zookeeper/zookeeperManagerMachine'
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

type ActiveZookeeperSession = Readonly<{
  actor: ZookeeperManagerActor
  stop: () => void
}>

type ZookeeperManagerModule = Pick<
  typeof import('@src/lib/zookeeper/zookeeperManagerMachine'),
  'createZookeeperManagerActor' | 'stopZookeeperManagerActor'
>

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
  let currentScope: ZookeeperSessionScope | undefined
  let retainedScope: ZookeeperSessionScope | undefined
  let sessionGeneration = 0
  let activeSession: ActiveZookeeperSession | undefined
  let attachedHosts = 0
  let hostGeneration = 0
  let disposed = false

  const clearActiveSession = () => {
    const previousSession = activeSession
    activeSession = undefined
    session.value = undefined
    previousSession?.stop()
  }

  const updateScope = async (scope: ZookeeperSessionScope | undefined) => {
    if (disposed || scopesMatch(retainedScope, scope)) {
      return
    }

    retainedScope = scope
    const generation = ++sessionGeneration
    clearActiveSession()
    if (!scope) {
      return
    }

    try {
      const manager = await loadManager()
      if (
        disposed ||
        generation !== sessionGeneration ||
        !scopesMatch(retainedScope, scope)
      ) {
        return
      }

      const actor = manager.createZookeeperManagerActor(scope.apiToken)
      activeSession = {
        actor,
        stop: () => manager.stopZookeeperManagerActor(actor),
      }
      session.value = {
        actor,
        generation,
        isCurrent: () =>
          !disposed &&
          attachedHosts > 0 &&
          generation === sessionGeneration &&
          activeSession?.actor === actor,
        scope,
      }
    } catch (error: unknown) {
      if (disposed || generation !== sessionGeneration) {
        return
      }
      retainedScope = undefined
      console.error('Failed to start the Zookeeper session.', error)
    }
  }

  const reconcileScope = () => {
    if (attachedHosts === 0) {
      return updateScope(undefined)
    }
    if (!currentScope || paneNode.peek()) {
      return updateScope(currentScope)
    }
    if (!scopesMatch(retainedScope, currentScope)) {
      return updateScope(undefined)
    }
    return Promise.resolve()
  }

  return {
    paneNode,
    paneProps,
    session,
    attachHost() {
      if (disposed) {
        return () => undefined
      }

      attachedHosts += 1
      hostGeneration += 1
      let attached = true

      return () => {
        if (!attached || disposed) {
          return
        }
        attached = false
        attachedHosts -= 1
        const releaseGeneration = ++hostGeneration
        if (attachedHosts > 0) {
          return
        }

        queueMicrotask(() => {
          if (
            disposed ||
            attachedHosts > 0 ||
            releaseGeneration !== hostGeneration
          ) {
            return
          }
          currentScope = undefined
          void updateScope(undefined)
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
      void reconcileScope()

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
    syncScope(scope: ZookeeperSessionScope | undefined) {
      currentScope = scope
      return reconcileScope()
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
      currentScope = undefined
      retainedScope = undefined
      sessionGeneration += 1
      clearActiveSession()
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

  useLayoutEffect(() => {
    const releaseHost = runtime.attachHost()
    void runtime.syncScope(
      projectPath && token ? { apiToken: token, projectPath } : undefined
    )
    return releaseHost
  }, [projectPath, runtime, token])

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
