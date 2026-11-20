import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useStepFilePicker } from '@src/hooks/useStepFilePicker'
import fsZds from '@src/lib/fs-zds'
import toast from 'react-hot-toast'

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    readFile: vi.fn(),
    basename: (path: string) => path.split(/[\\/]/).pop(),
  },
}))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }))

describe('desktop STEP file picker', () => {
  const open = vi.fn()
  const originalElectron = window.electron
  const sourcePath = 'C:\\models\\Claude Box.step'

  beforeEach(() => {
    vi.resetAllMocks()
    window.electron = { open } as unknown as typeof window.electron
    vi.mocked(fsZds.readFile).mockResolvedValue(new Uint8Array([65, 66, 67]))
  })

  afterEach(() => {
    window.electron = originalElectron
    vi.restoreAllMocks()
  })

  test('reopens after repeated cancel, then selects the same file twice', async () => {
    open
      .mockResolvedValueOnce({ canceled: true, filePaths: [] })
      .mockResolvedValueOnce({ canceled: true, filePaths: [] })
      .mockResolvedValue({ canceled: false, filePaths: [sourcePath] })
    const onFile = vi.fn()
    const { result, rerender } = renderHook(() => useStepFilePicker(onFile))

    await act(() => result.current.pickFile())
    rerender()
    await act(() => result.current.pickFile())
    expect(open).toHaveBeenCalledTimes(2)
    expect(onFile).not.toHaveBeenCalled()
    expect(fsZds.readFile).not.toHaveBeenCalled()

    await act(() => result.current.pickFile())
    await act(() => result.current.pickFile())
    expect(open).toHaveBeenCalledTimes(4)
    expect(onFile).toHaveBeenCalledTimes(2)
    const file = onFile.mock.calls[1][0] as File
    expect(file.name).toBe('Claude Box.step')
    expect(await file.text()).toBe('ABC')
  })

  test('ignores duplicate clicks only while a dialog is open', async () => {
    let cancel!: (result: { canceled: boolean; filePaths: string[] }) => void
    open.mockReturnValueOnce(
      new Promise((resolve) => {
        cancel = resolve
      })
    )
    const onFile = vi.fn()
    const { result } = renderHook(() => useStepFilePicker(onFile))

    const pending = result.current.pickFile()
    await result.current.pickFile()
    expect(open).toHaveBeenCalledTimes(1)
    cancel({ canceled: true, filePaths: [] })
    await pending

    open.mockResolvedValue({ canceled: true, filePaths: [] })
    await result.current.pickFile()
    expect(open).toHaveBeenCalledTimes(2)
  })

  test('can retry after the dialog or file read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    open
      .mockRejectedValueOnce(new Error('dialog failed'))
      .mockResolvedValue({ canceled: false, filePaths: [sourcePath] })
    vi.mocked(fsZds.readFile).mockRejectedValueOnce(new Error('file missing'))
    const onFile = vi.fn()
    const { result } = renderHook(() => useStepFilePicker(onFile))

    await result.current.pickFile()
    await result.current.pickFile()
    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(onFile).not.toHaveBeenCalled()

    await result.current.pickFile()
    expect(onFile).toHaveBeenCalledTimes(1)
  })
})
