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
  mockToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: mockToast,
}))

import {
  browserSaveFile,
  getShowSaveFilePickerOptions,
} from '@src/lib/browserSaveFile'
import { EXPORT_TOAST_MESSAGES } from '@src/lib/constants'

type ShowSaveFilePicker = (options?: SaveFilePickerOptions) => Promise<unknown>

const setShowSaveFilePicker = (showSaveFilePicker: ShowSaveFilePicker) => {
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: showSaveFilePicker,
  })
}

const removeShowSaveFilePicker = () => {
  Reflect.deleteProperty(window, 'showSaveFilePicker')
}

describe('browserSaveFile', () => {
  let clickSpy: MockInstance<() => void>
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    mockToast.dismiss.mockClear()
    mockToast.error.mockClear()
    mockToast.success.mockClear()
    removeShowSaveFilePicker()

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
    removeShowSaveFilePicker()
  })

  it('uses the download fallback when showSaveFilePicker is unavailable', async () => {
    const blob = new Blob(['contents'])

    await browserSaveFile(blob, 'main.step', 'toast-id')

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(document.querySelector('a')?.download).toBe('main.step')
    expect(mockToast.success).toHaveBeenCalledWith(
      EXPORT_TOAST_MESSAGES.SUCCESS,
      { id: 'toast-id' }
    )

    vi.runOnlyPendingTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
    expect(document.querySelector('a')).toBeNull()
  })

  it('falls back to download when the file picker is blocked', async () => {
    const blob = new Blob(['contents'])
    const showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(
        new DOMException('Denied by platform policy', 'NotAllowedError')
      )
    setShowSaveFilePicker(showSaveFilePicker)

    await browserSaveFile(blob, 'main.step', 'toast-id')

    expect(showSaveFilePicker).toHaveBeenCalledWith(
      getShowSaveFilePickerOptions('main.step')
    )
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(mockToast.error).not.toHaveBeenCalled()
    expect(mockToast.success).toHaveBeenCalledWith(
      EXPORT_TOAST_MESSAGES.SUCCESS,
      { id: 'toast-id' }
    )
  })

  it('does not fall back to download when the user cancels the file picker', async () => {
    const showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException('User canceled', 'AbortError'))
    setShowSaveFilePicker(showSaveFilePicker)

    await browserSaveFile(new Blob(['contents']), 'main.step', 'toast-id')

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(clickSpy).not.toHaveBeenCalled()
    expect(mockToast.dismiss).toHaveBeenCalledWith('toast-id')
    expect(mockToast.success).not.toHaveBeenCalled()
  })
})

describe('getShowSaveFilePickerOptions', () => {
  it('adds extension-constrained picker options when suggestedName has an extension', () => {
    expect(getShowSaveFilePickerOptions('main.step')).toEqual({
      suggestedName: 'main.step',
      types: [
        {
          description: 'STEP files',
          accept: {
            'application/octet-stream': ['.step'],
          },
        },
      ],
      excludeAcceptAllOption: true,
    })
  })

  it('only sets suggestedName when there is no extension', () => {
    expect(getShowSaveFilePickerOptions('foo')).toEqual({
      suggestedName: 'foo',
    })
  })
})
