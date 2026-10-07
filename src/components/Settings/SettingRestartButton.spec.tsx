import { SettingRestartButton } from '@src/components/Settings/SettingRestartButton'
import { useApp, useSingletons } from '@src/lib/boot'
import { Setting } from '@src/lib/settings/Setting'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'

vi.mock('@src/lib/boot', () => ({ useApp: vi.fn(), useSingletons: vi.fn() }))
vi.mock(import('react-router-dom'), async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: vi.fn(),
  useLocation: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

function setup({ connected = true } = {}) {
  const setting = new Setting<boolean>({
    defaultValue: true,
    validate: (v) => typeof v === 'boolean',
    restartRequired: (value, engineCommandManager) =>
      engineCommandManager.connection !== undefined &&
      engineCommandManager.geometryOnly !== value,
  })
  const actor = createActor(
    createMachine({
      initial: 'persisting settings',
      states: {
        'persisting settings': { on: { saved: 'idle' } },
        idle: {},
      },
    })
  ).start()
  vi.mocked(useApp).mockReturnValue({
    settings: { actor },
  } as unknown as ReturnType<typeof useApp>)
  vi.mocked(useSingletons).mockReturnValue({
    kclManager: {
      engineCommandManager: {
        connection: connected ? {} : undefined,
        geometryOnly: connected,
      },
    },
  } as unknown as ReturnType<typeof useSingletons>)
  const events: string[] = []
  const navigate = vi.fn(async (to: string) => {
    events.push(`navigate ${to}`)
  })
  vi.mocked(useNavigate).mockReturnValue(
    navigate as unknown as ReturnType<typeof useNavigate>
  )
  vi.mocked(useLocation).mockReturnValue({
    pathname: '/file/some-project/settings',
  } as ReturnType<typeof useLocation>)
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {
    events.push('reload')
  })
  render(<SettingRestartButton setting={setting as Setting<unknown>} />)
  return { setting, actor, reload, events }
}

test('is hidden while the live session already uses the saved value', () => {
  const { setting } = setup()
  expect(screen.queryByRole('button')).toBeNull()

  act(() => {
    setting.user = false
  })
  expect(screen.getByRole('button').textContent).toContain('Restart to apply')
})

test('is hidden when there is no engine session to restart', () => {
  const { setting } = setup({ connected: false })
  act(() => {
    setting.user = false
  })
  expect(screen.queryByRole('button')).toBeNull()
})

test('saves the change and closes settings before restarting', async () => {
  const { setting, actor, reload, events } = setup()
  act(() => {
    setting.user = false
  })
  fireEvent.click(screen.getByRole('button'))
  await Promise.resolve()
  expect(events).toEqual([])

  actor.send({ type: 'saved' })
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
  expect(events).toEqual(['navigate /file/some-project', 'reload'])
})
