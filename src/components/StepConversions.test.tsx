import {
  StepConversionDialog,
  StepConversions,
} from '@src/components/StepConversions'
import { webSafeJoin } from '@src/lib/paths'
import type { StepConversion } from '@src/lib/stepConversion'
import type * as ConversionModule from '@src/lib/stepConversion'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jobs: [] as StepConversion[],
  configure: vi.fn().mockResolvedValue(undefined),
  enqueue: vi.fn().mockResolvedValue(undefined),
  retry: vi.fn().mockResolvedValue(undefined),
  savePath: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  error: vi.fn(),
}))
vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    auth: { useToken: () => 'token', useUser: () => ({ id: 'owner' }) },
  }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.error } }))
vi.mock('@src/lib/fs-zds', () => ({
  default: {
    join: (...parts: string[]) => webSafeJoin(parts),
    dirname: (path: string) => path.substring(0, path.lastIndexOf('/')),
    mkdir: mocks.mkdir,
    writeFile: mocks.writeFile,
  },
}))
vi.mock('@src/lib/stepConversion', async (original) => ({
  ...(await original<typeof ConversionModule>()),
  stepConversions: {
    getSnapshot: () => mocks.jobs,
    subscribe: () => () => {},
    configure: mocks.configure,
    enqueue: mocks.enqueue,
    retry: mocks.retry,
    savePath: mocks.savePath,
  },
}))
const source = new File(['ISO-10303-21;'], 'bracket.step')
const completed: StepConversion = {
  id: 'conversion',
  ownerId: 'owner',
  projectPath: '/original-project',
  source,
  status: 'completed',
  attempts: 1,
  files: { 'main.kcl': 'width = 10mm' },
  summary: 'The fillets remain approximate.',
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.jobs = []
})

describe('conversion confirmation', () => {
  test('shows credit and geometry notices before starting', async () => {
    const close = vi.fn()
    render(
      <StepConversionDialog
        source={source}
        projectPath="/project"
        onClose={close}
      />
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/uses Zookeeper reasoning credits/)).toBeVisible()
    expect(
      screen.getByText(/Check the resulting geometry and parameter edits/)
    ).toBeVisible()
    expect(mocks.enqueue).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Start conversion' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(mocks.enqueue).toHaveBeenCalledWith('/project', source)
  })
  test('cancel does not start inference', () => {
    const close = vi.fn()
    render(
      <StepConversionDialog
        source={source}
        projectPath="/project"
        onClose={close}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(close).toHaveBeenCalledOnce()
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
  test('storage failure keeps the dialog open with a clear error', async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error('Storage full'))
    const close = vi.fn()
    render(
      <StepConversionDialog
        source={source}
        projectPath="/project"
        onClose={close}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start conversion' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage full')
    expect(close).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Start conversion' })
    ).toBeEnabled()
  })
})

describe('background conversion status', () => {
  test('shows queued, running, completed, and failed states with explicit credit notice on retry', async () => {
    mocks.jobs = ['queued', 'running', 'completed', 'failed'].map((status) => ({
      ...completed,
      id: status,
      status: status as StepConversion['status'],
      error: status === 'failed' ? 'Connection lost' : undefined,
    }))
    render(<StepConversions />)
    expect(
      screen.getAllByRole('status').map((item) => item.textContent)
    ).toEqual(['queued', 'running', 'completed', 'failed'])
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost')
    expect(
      screen.getByText('The fillets remain approximate.')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry…' }))
    expect(
      screen.getByText(/new attempt and uses reasoning credits/)
    ).toBeVisible()
    expect(mocks.retry).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry conversion' }))
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('failed'))
  })
  test('opens results in a new folder in the originally selected project', async () => {
    mocks.jobs = [completed]
    render(<StepConversions />)
    fireEvent.click(screen.getByRole('button', { name: 'Open KCL' }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce())
    const path = mocks.savePath.mock.calls[0][1] as string
    expect(path).toMatch(/^\/original-project\/converted-[^/]+\/main.kcl$/)
    expect(mocks.writeFile).toHaveBeenCalledWith(
      path,
      new TextEncoder().encode('width = 10mm')
    )
    expect(mocks.navigate).toHaveBeenCalledWith(
      `/file/${encodeURIComponent(path)}`
    )
  })
  test('opening a saved result again preserves user edits', async () => {
    mocks.jobs = [
      { ...completed, savedPath: '/original-project/converted/result.kcl' },
    ]
    render(<StepConversions />)
    fireEvent.click(screen.getByRole('button', { name: 'Open KCL' }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce())
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })
  test('disk write failure retains the result and lets the user try opening again', async () => {
    mocks.jobs = [completed]
    mocks.writeFile.mockRejectedValueOnce(new Error('disk full'))
    render(<StepConversions />)
    fireEvent.click(screen.getByRole('button', { name: 'Open KCL' }))
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        expect.stringContaining('conversion is retained')
      )
    )
    expect(mocks.navigate).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open KCL' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open KCL' }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce())
    expect(mocks.mkdir.mock.calls[0][0]).not.toEqual(
      mocks.mkdir.mock.calls[2][0]
    )
  })
})
