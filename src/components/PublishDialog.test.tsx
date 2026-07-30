import { Popover } from '@headlessui/react'
import type { MarkdownEditorActions } from '@kittycad/ui-components'
import { PublishDialog } from '@src/components/PublishDialog'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const category = {
  id: 'robotics',
  display_name: 'Robotics',
  description: 'Robotics projects',
  sort_order: 1,
}

describe('PublishDialog', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([category]),
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers the description editor with the Markdown keymap while focused', async () => {
    const unregisterActions = vi.fn()
    const registerActions = vi.fn((actions: MarkdownEditorActions) => {
      void actions
      return unregisterActions
    })
    const focusScope = {
      onFocus: vi.fn(),
      onBlur: vi.fn(),
    }

    render(
      <Popover>
        <PublishDialog
          onSubmit={vi.fn()}
          accountUrl="https://zoo.dev/account"
          markdownEditorKeymap={{ focusScope, registerActions }}
        />
      </Popover>
    )

    const editor = await screen.findByTestId(
      'publish-project-description-editor'
    )
    fireEvent.focus(editor)

    await waitFor(() => {
      expect(focusScope.onFocus).toHaveBeenCalledTimes(1)
      expect(registerActions).toHaveBeenCalledTimes(1)
    })
    expect(registerActions.mock.calls[0][0]).toMatchObject({
      setLink: expect.any(Function),
    })

    fireEvent.blur(editor)

    await waitFor(() => {
      expect(unregisterActions).toHaveBeenCalledTimes(1)
      expect(focusScope.onBlur).toHaveBeenCalledTimes(1)
    })
  })
})
