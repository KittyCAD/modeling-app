import { signal } from '@preact/signals-core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

vi.mock('@src/clientSideScene/localRenderer/LocalWebGPUScene', () => ({
  LocalWebGPUSceneView: () => null,
}))

import { KclScene } from '@src/lib/kcl/KclScene'
import { createSceneSelection } from '@src/lib/scene/selection'
import type { Executor } from '@src/lib/executors/registry/contract'
import { createExecutorOutput } from '@src/lib/executors/output'
import type { KclSession } from '@src/lib/kcl/session'
import type { KclSceneResource } from '@src/lib/kcl/scene'

it('keeps the visible selection count across remounts and lets the user clear it', async () => {
  const selection = createSceneSelection(
    {
      pick: async () => ({
        reference: { type: 'region', region_id: 'profile' },
      }),
      present: async () => {},
    },
    ['region']
  )
  selection.setModel({ sceneId: Symbol(), executionId: Symbol() })
  const resource = {
    selection,
    preferences: signal(undefined),
    localHost: undefined,
  } as unknown as KclSceneResource
  const session = {
    resource: signal(resource),
    state: signal({ type: 'ready' }),
    mount: () => () => {},
  } as unknown as KclSession
  const executor = {
    output: signal(
      createExecutorOutput({ contents: '', src: '/main.kcl', running: false })
    ),
  } as unknown as Executor
  try {
    const first = render(<KclScene context={{ executor, session }} />)
    expect(screen.getByLabelText('Scene selection')).toHaveTextContent(
      '0 selected'
    )
    await act(async () => {
      await selection.pick({ clientX: 1, clientY: 0 })
    })
    expect(selection.selected.peek()).toHaveLength(1)
    expect(screen.getByLabelText('Scene selection')).toHaveTextContent(
      '1 selected'
    )
    first.unmount()
    render(<KclScene context={{ executor, session }} />)
    expect(screen.getByLabelText('Scene selection')).toHaveTextContent(
      '1 selected'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByLabelText('Scene selection')).toHaveTextContent(
      '0 selected'
    )
    expect(
      screen.getByRole('button', { name: 'Clear selection' })
    ).toBeDisabled()
  } finally {
    selection.dispose()
  }
})
