import {
  autocompletion,
  completionStatus,
  startCompletion,
} from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createCommandBarKclInputKeymap } from '@src/components/CommandBar/commandBarKclInputKeymap'
import { describe, expect, it, vi } from 'vitest'

describe('command bar KCL input keymap', () => {
  it('submits when autocomplete is inactive', () => {
    const onSubmit = vi.fn()
    const view = new EditorView({
      state: EditorState.create(),
    })
    const [enter] = createCommandBarKclInputKeymap({
      onSubmit,
      stepBack: vi.fn(),
    })

    expect(enter.run?.(view)).toBe(true)
    expect(enter.preventDefault).toBe(true)
    expect(onSubmit).toHaveBeenCalledOnce()
    view.destroy()
  })

  it('consumes Enter without submitting while autocomplete is pending', () => {
    const onSubmit = vi.fn()
    const view = new EditorView({
      state: EditorState.create({
        doc: 'wid',
        extensions: [
          autocompletion({
            override: [() => new Promise(() => {})],
          }),
        ],
      }),
    })
    const [enter] = createCommandBarKclInputKeymap({
      onSubmit,
      stepBack: vi.fn(),
    })

    expect(startCompletion(view)).toBe(true)
    expect(completionStatus(view.state)).toBe('pending')
    expect(enter.run?.(view)).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(view.state.doc.toString()).toBe('wid')
    view.destroy()
  })
})
