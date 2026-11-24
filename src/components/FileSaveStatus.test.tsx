import { signal } from '@preact/signals-core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectWriteAvailability } from '@src/lib/projectSession/storage'

const editor = {
  codeSignal: signal('saved contents'),
  saveState: signal<'saved' | 'saving' | 'failed'>('saved'),
  hasUnsavedLocalChanges: () => editor.codeSignal.peek() !== 'saved contents',
}
const project = { path: '/project', executingEditor: signal(editor) }
const projectSignal = signal<typeof project | undefined>(project)
const writeAvailability = signal<ProjectWriteAvailability>({ writable: true })
const saveState = signal<{ state: 'saved' | 'saving' | 'failed' } | undefined>(
  undefined
)
const retrySave = vi.fn(async () => undefined)

import { FileSaveStatus } from '@src/components/FileSaveStatus'

const props = {
  project: projectSignal,
  storageFor: () => ({ writeAvailability, saveState }),
  retrySave,
}

beforeEach(() => {
  projectSignal.value = project
  editor.codeSignal.value = 'saved contents'
  editor.saveState.value = 'saved'
  writeAvailability.value = { writable: true }
  saveState.value = undefined
  retrySave.mockClear()
})

describe('project save status', () => {
  it('shows an unsaved dot during the autosave delay and clears it after saving', () => {
    const { container } = render(<FileSaveStatus {...props} />)
    expect(container).toBeEmptyDOMElement()

    act(() => {
      editor.codeSignal.value = 'new contents'
    })
    expect(screen.getByRole('img', { name: 'Unsaved changes' })).toBeVisible()
    expect(screen.queryByText('Saving...')).not.toBeInTheDocument()

    act(() => {
      editor.saveState.value = 'saving'
    })
    expect(screen.getByRole('status')).toHaveTextContent('Saving...')
    expect(screen.getByRole('img', { name: 'Unsaved changes' })).toBeVisible()

    act(() => {
      editor.codeSignal.value = 'saved contents'
      editor.saveState.value = 'saved'
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps failed saves marked as unsaved and retries when requested', async () => {
    editor.saveState.value = 'failed'
    render(<FileSaveStatus {...props} />)

    expect(screen.getByRole('img', { name: 'Unsaved changes' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Save failed. Retry' }))
    await vi.waitFor(() => expect(retrySave).toHaveBeenCalledOnce())
  })

  it.each(['saving', 'failed'] as const)(
    'shows project storage %s even when the editor has finished its local save',
    (state) => {
      saveState.value = { state }
      render(<FileSaveStatus {...props} />)
      expect(screen.getByRole('img', { name: 'Unsaved changes' })).toBeVisible()
      expect(screen.getByRole('status')).toHaveTextContent(
        state === 'saving' ? 'Saving...' : 'Save failed. Retry'
      )
    }
  )

  it.each(['Offline', 'Read-only'])(
    'shows %s in place of Retry when writing is unavailable',
    (reason) => {
      saveState.value = { state: 'failed' }
      writeAvailability.value = { writable: false, reason }
      render(<FileSaveStatus {...props} />)
      expect(screen.getByRole('status')).toHaveTextContent(reason)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    }
  )

  it('removes the previous project status when the project closes', () => {
    saveState.value = { state: 'failed' }
    const { container } = render(<FileSaveStatus {...props} />)
    act(() => {
      projectSignal.value = undefined
    })
    expect(container).toBeEmptyDOMElement()
  })
})
