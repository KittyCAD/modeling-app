import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { UpdateManifest } from '@tauri-apps/api/updater'
import { UpdaterRestartModal } from './UpdaterRestartModal'

describe('UpdaterRestartModal tests', () => {
  test('Renders the modal', () => {
    const callback = vi.fn()
    const data: UpdateManifest = {
      version: 'version',
      date: 'date',
      body: 'body',
    }

    render(
      <UpdaterRestartModal
        isOpen={true}
        onReject={() => {}}
        onResolve={callback}
        instanceId=""
        open={false}
        close={(res) => {}}
        version={data.version}
        date={data.date}
        body={data.body}
      />
    )

    expect(screen.getByTestId('update-restart-version')).toHaveTextContent(
      data.version
    )
    // data and body will likely get transformed. No test for now

    const updateButton = screen.getByTestId('update-restrart-button-update')
    expect(updateButton).toBeEnabled()
    fireEvent.click(updateButton)
    expect(callback.mock.calls).toHaveLength(1)
    expect(callback.mock.lastCall[0]).toEqual({ wantRestart: true })

    const cancelButton = screen.getByTestId('update-restrart-button-cancel')
    expect(cancelButton).toBeEnabled()
    fireEvent.click(cancelButton)
    expect(callback.mock.calls).toHaveLength(2)
    expect(callback.mock.lastCall[0]).toEqual({ wantRestart: false })
  })
})
