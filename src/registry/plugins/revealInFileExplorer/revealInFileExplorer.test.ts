import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canRevealInFileExplorer,
  revealInFileExplorer,
} from './revealInFileExplorer'

const originalElectron = window.electron

afterEach(() => {
  window.electron = originalElectron
})

describe('revealInFileExplorer', () => {
  it('reports whether Electron reveal support is available', () => {
    window.electron = undefined

    expect(canRevealInFileExplorer()).toBe(false)
  })

  it('uses the Electron file manager reveal bridge', () => {
    const showInFolder = vi.fn()
    window.electron = {
      showInFolder,
    } as unknown as Window['electron']

    expect(canRevealInFileExplorer()).toBe(true)

    revealInFileExplorer('/project/main.kcl')

    expect(showInFolder).toHaveBeenCalledWith('/project/main.kcl')
  })
})
