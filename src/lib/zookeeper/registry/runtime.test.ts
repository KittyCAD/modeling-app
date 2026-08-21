import {
  AreaType,
  type AreaTypeComponentProps,
  LayoutType,
} from '@src/lib/layout/types'
import { createZookeeperRuntime } from '@src/lib/zookeeper/registry/runtime'
import type { ZookeeperManagerActor } from '@src/lib/zookeeper/zookeeperManagerMachine'
import { afterEach, describe, expect, it, vi } from 'vitest'

const paneProps: AreaTypeComponentProps = {
  areaConfig: { hide: () => false },
  layout: {
    areaType: AreaType.Zookeeper,
    id: 'zookeeper',
    label: 'Zookeeper',
    type: LayoutType.Simple,
  },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('Zookeeper runtime', () => {
  afterEach(() => document.body.replaceChildren())

  it('moves one persistent host when the pane closes and reopens', () => {
    const runtime = createZookeeperRuntime()
    const firstOutlet = document.createElement('div')
    const secondOutlet = document.createElement('div')
    document.body.append(firstOutlet, secondOutlet)
    const host = runtime.getPortalHost()

    runtime.updatePaneProps(paneProps)
    const detachFirst = runtime.attachPane(firstOutlet)
    expect(firstOutlet).toContainElement(host)

    detachFirst()
    expect(host).not.toBeInTheDocument()
    expect(runtime.paneProps.value).toBe(paneProps)

    runtime.attachPane(secondOutlet)
    expect(secondOutlet).toContainElement(host)
    expect(runtime.getPortalHost()).toBe(host)

    runtime.dispose()
    expect(host).not.toBeInTheDocument()
  })

  it('owns one actor across pane and host remounts', async () => {
    const actor = {} as ZookeeperManagerActor
    const createZookeeperManagerActor = vi.fn(() => actor)
    const stopZookeeperManagerActor = vi.fn()
    const runtime = createZookeeperRuntime(async () => ({
      createZookeeperManagerActor,
      stopZookeeperManagerActor,
    }))
    const releaseHost = runtime.attachHost()
    const outlet = document.createElement('div')
    const detach = runtime.attachPane(outlet)
    const scope = { apiToken: 'token', projectPath: '/project' }

    await runtime.syncScope(scope)
    expect(runtime.session.value?.actor).toBe(actor)
    const session = runtime.session.value

    detach()
    await runtime.syncScope(scope)
    runtime.attachPane(outlet)
    await runtime.syncScope(scope)

    expect(runtime.session.value?.actor).toBe(actor)
    expect(createZookeeperManagerActor).toHaveBeenCalledOnce()
    expect(stopZookeeperManagerActor).not.toHaveBeenCalled()
    expect(session?.isCurrent()).toBe(true)

    releaseHost()
    const releaseRemountedHost = runtime.attachHost()
    await Promise.resolve()
    expect(stopZookeeperManagerActor).not.toHaveBeenCalled()
    expect(session?.isCurrent()).toBe(true)

    releaseRemountedHost()
    await vi.waitFor(() => {
      expect(stopZookeeperManagerActor).toHaveBeenCalledWith(actor)
    })
    expect(session?.isCurrent()).toBe(false)
  })

  it('ignores stale loads and defers a hidden project session', async () => {
    const activeActor = {} as ZookeeperManagerActor
    const replacementActor = {} as ZookeeperManagerActor
    const createZookeeperManagerActor = vi
      .fn()
      .mockReturnValueOnce(activeActor)
      .mockReturnValueOnce(replacementActor)
    const stopZookeeperManagerActor = vi.fn()
    const manager = { createZookeeperManagerActor, stopZookeeperManagerActor }
    const managerLoad = deferred<typeof manager>()
    const runtime = createZookeeperRuntime(() => managerLoad.promise)
    runtime.attachHost()

    const firstScope = { apiToken: 'first', projectPath: '/first' }
    const secondScope = { apiToken: 'second', projectPath: '/second' }
    const outlet = document.createElement('div')
    const detach = runtime.attachPane(outlet)
    const firstLoad = runtime.syncScope(firstScope)
    const secondLoad = runtime.syncScope(secondScope)

    managerLoad.resolve(manager)
    await Promise.all([firstLoad, secondLoad])

    expect(createZookeeperManagerActor).toHaveBeenCalledOnce()
    expect(createZookeeperManagerActor).toHaveBeenCalledWith('second')
    expect(runtime.session.value).toMatchObject({
      actor: activeActor,
      scope: secondScope,
    })
    const activeSession = runtime.session.value

    const thirdScope = { apiToken: 'third', projectPath: '/third' }
    detach()
    await runtime.syncScope(thirdScope)
    expect(stopZookeeperManagerActor).toHaveBeenCalledWith(activeActor)
    expect(activeSession?.isCurrent()).toBe(false)
    expect(runtime.session.value).toBeUndefined()
    expect(createZookeeperManagerActor).toHaveBeenCalledOnce()

    runtime.attachPane(outlet)
    await vi.waitFor(() => {
      expect(runtime.session.value?.actor).toBe(replacementActor)
    })
    runtime.dispose()
    expect(stopZookeeperManagerActor).toHaveBeenCalledWith(replacementActor)
  })

  it('does not start an actor after disposal', async () => {
    const createZookeeperManagerActor = vi.fn()
    const stopZookeeperManagerActor = vi.fn()
    const manager = { createZookeeperManagerActor, stopZookeeperManagerActor }
    const managerLoad = deferred<typeof manager>()
    const runtime = createZookeeperRuntime(() => managerLoad.promise)
    runtime.attachHost()
    runtime.attachPane(document.createElement('div'))
    const activation = runtime.syncScope({
      apiToken: 'token',
      projectPath: '/project',
    })

    runtime.dispose()
    managerLoad.resolve(manager)
    await activation

    expect(createZookeeperManagerActor).not.toHaveBeenCalled()
    expect(runtime.session.value).toBeUndefined()
  })
})
