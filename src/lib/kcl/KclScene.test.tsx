import { signal } from '@preact/signals-core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

vi.mock('@src/clientSideScene/localRenderer/LocalWebGPUScene', () => ({
  LocalWebGPUSceneView: () => null,
}))

import { KclScene } from '@src/lib/kcl/KclScene'
import { createSceneSelection } from '@src/lib/scene/selection'
import { createExecutor } from '@src/lib/executors/executor'
import { createEditorDocument } from '@src/lib/editors/document'
import { createTestKclScene } from '@src/lib/kcl/testFixtures'
import { createKclSession } from '@src/lib/kcl/session'

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
  const resource = createTestKclScene('streamed', { selection })
  const session = createKclSession(async () => resource)
  session.resource.value = resource
  session.state.value = { type: 'ready' }
  const backing = createEditorDocument('')
  const editor = {
    ...backing.document,
    get state() {
      return backing.document.state
    },
    id: Symbol(),
    src: signal('/main.kcl'),
    classification: signal(undefined),
    readOnly: signal(false),
  }
  const owned = createExecutor(editor, signal([]), () => {})
  const executor = owned.executor
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
    session.dispose()
    owned.dispose()
    backing.dispose()
    selection.dispose()
  }
})
