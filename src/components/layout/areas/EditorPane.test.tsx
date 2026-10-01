import { EditorView } from '@codemirror/view'
import { signal } from '@preact/signals-core'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  scheduleWrite: vi.fn(),
  flushWrite: vi.fn().mockResolvedValue(undefined),
  fileOperations: {},
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    fileOperations: mocks.fileOperations,
    settings: {
      useSettings: () => ({ app: { theme: { current: 'light' } } }),
    },
  }),
  useSingletons: () => ({
    kclManager: { editorView: { dom: document.createElement('div') } },
  }),
}))
vi.mock('@src/lib/activeTextFile', () => ({
  activeTextFileSignal: signal({
    path: '/proj/settings.json',
    name: 'settings.json',
    status: 'ready',
    text: '',
  }),
  clearActiveTextFile: vi.fn(),
  flushActiveTextFileWrite: mocks.flushWrite,
  scheduleActiveTextFileWrite: mocks.scheduleWrite,
}))
vi.mock('@src/hooks/useToolbarGuards', () => ({
  useConvertToVariable: vi.fn(),
}))
vi.mock('@src/registry/extensions/commands/appCommands', () => ({
  APP_COMMAND_IDS: {},
}))
vi.mock('@src/components/layout/Panel', () => ({
  LayoutPanel: vi.fn(),
  LayoutPanelHeader: vi.fn(),
}))
vi.mock('@src/components/layout/Panel/HeaderMenu', () => ({
  HeaderMenu: vi.fn(),
}))

import { EditorPaneContents } from '@src/components/layout/areas/EditorPane'
import { activeTextFileSignal } from '@src/lib/activeTextFile'

describe('plain text editor', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['\n', '\r\n', '\r'])(
    'preserves BOM and %j line endings on edit',
    (lineEnding) => {
      const original = `\ufefffirst${lineEnding}second${lineEnding}`
      activeTextFileSignal.value = {
        path: '/proj/settings.json',
        name: 'settings.json',
        status: 'ready',
        text: original,
      }
      const { unmount } = render(<EditorPaneContents />)
      const view = EditorView.findFromDOM(screen.getByRole('textbox'))
      expect(view).not.toBeNull()
      act(() =>
        view?.dispatch({ changes: { from: 1, to: 6, insert: 'edited' } })
      )
      expect(mocks.scheduleWrite).toHaveBeenLastCalledWith(
        mocks.fileOperations,
        '/proj/settings.json',
        `\ufeffedited${lineEnding}second${lineEnding}`
      )
      unmount()
      expect(mocks.flushWrite).toHaveBeenCalled()
    }
  )

  it('shows rejected files without mounting an editable buffer', () => {
    activeTextFileSignal.value = {
      path: '/proj/image.png',
      name: 'image.png',
      status: 'error',
      text: '',
      error: 'This file is binary or is not UTF-8 text.',
    }
    render(<EditorPaneContents />)
    expect(screen.getByText(/This file is binary/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(mocks.scheduleWrite).not.toHaveBeenCalled()
  })
})
