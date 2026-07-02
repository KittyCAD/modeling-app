import {
  canRevealInFileExplorer,
  revealInFileExplorer,
} from '@src/lib/revealInFileExplorer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalElectron = window.electron

afterEach(() => {
  window.electron = originalElectron
  vi.restoreAllMocks()
})

describe('revealInFileExplorer', () => {
  it('reports whether Electron reveal support is available', () => {
    window.electron = undefined

    expect(canRevealInFileExplorer()).toBe(false)
  })

  it('uses the Electron file manager reveal bridge', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Electron')
    const showInFolder = vi.fn()
    window.electron = {
      showInFolder,
    } as unknown as Window['electron']

    expect(canRevealInFileExplorer()).toBe(true)

    revealInFileExplorer('/project/main.kcl')

    expect(showInFolder).toHaveBeenCalledWith('/project/main.kcl')
  })

  it('hides reveal support outside the desktop app', () => {
    const showInFolder = vi.fn()
    window.electron = {
      showInFolder,
    } as unknown as Window['electron']

    expect(canRevealInFileExplorer()).toBe(false)
  })
})
