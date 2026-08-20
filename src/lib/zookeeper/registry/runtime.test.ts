import {
  AreaType,
  type AreaTypeComponentProps,
  LayoutType,
} from '@src/lib/layout/types'
import { createZookeeperPortalRuntime } from '@src/lib/zookeeper/registry/runtime'
import { afterEach, describe, expect, it } from 'vitest'

const paneProps: AreaTypeComponentProps = {
  areaConfig: { hide: () => false },
  layout: {
    areaType: AreaType.Zookeeper,
    id: 'zookeeper',
    label: 'Zookeeper',
    type: LayoutType.Simple,
  },
}

describe('Zookeeper portal runtime', () => {
  afterEach(() => document.body.replaceChildren())

  it('moves one persistent host when the pane closes and reopens', () => {
    const runtime = createZookeeperPortalRuntime()
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
})
