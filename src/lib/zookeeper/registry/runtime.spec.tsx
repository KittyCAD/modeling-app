import { signal } from '@preact/signals-core'
import { AreaType, LayoutType } from '@src/lib/layout/types'
import type { Project } from '@src/lib/project'
import type { ZookeeperSessionController } from '@src/lib/zookeeper/registry/controller'
import { ZookeeperPaneOutlet } from '@src/lib/zookeeper/registry/runtime'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

it('keeps the Zookeeper pane closeable while its controller starts', () => {
  const onClose = vi.fn()
  const runtime = {
    currentProject: signal({ path: '/project' } as Project),
    dispose: vi.fn(),
    session: signal<ZookeeperSessionController | undefined>(undefined),
  }

  render(
    <ZookeeperPaneOutlet
      areaConfig={{ hide: () => false }}
      layout={{
        areaType: AreaType.Zookeeper,
        id: 'zookeeper',
        label: 'Zookeeper',
        type: LayoutType.Simple,
      }}
      onClose={onClose}
      runtime={runtime}
    />
  )

  expect(screen.getByTestId('zookeeper-header')).toHaveTextContent('Zookeeper')
  expect(screen.getByText('Starting Zookeeper...')).toBeVisible()

  fireEvent.click(screen.getByRole('button'))
  expect(onClose).toHaveBeenCalledOnce()
})
