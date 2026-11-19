import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({
  default: mockToast,
}))

import { browserSaveFile } from '@src/lib/browserSaveFile'

describe('browserSaveFile', () => {
  let clickSpy: MockInstance<() => void>
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    mockToast.success.mockClear()

    createObjectURL = vi.fn(() => 'blob:export')
    revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it.each([true, false])(
    'downloads through a link when native picker support is %s',
    async (supportsPicker) => {
      const showSaveFilePicker = vi.fn()
      vi.stubGlobal(
        'showSaveFilePicker',
        supportsPicker ? showSaveFilePicker : undefined
      )
      const blob = new Blob(['contents'])

      await browserSaveFile(blob, 'main.step', 'toast-id')

      expect(showSaveFilePicker).not.toHaveBeenCalled()
      expect(createObjectURL).toHaveBeenCalledWith(blob)
      expect(clickSpy).toHaveBeenCalledTimes(1)
      expect(document.querySelector('a')?.download).toBe('main.step')
      expect(mockToast.success).toHaveBeenCalledWith('Download started', {
        id: 'toast-id',
      })

      vi.runOnlyPendingTimers()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
      expect(document.querySelector('a')).toBeNull()
    }
  )
})
