import {
  autocompletion,
  completionStatus,
  startCompletion,
} from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  createCommandBarKclInputKeymap,
  createCommandBarKclInputPendingEnterExtension,
} from '@src/components/CommandBar/commandBarKclInputKeymap'
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

  it('accepts autocomplete after Enter is pressed while it is pending', async () => {
    const onSubmit = vi.fn()
    let resolveCompletion:
      | ((result: { from: number; options: { label: string }[] }) => void)
      | undefined
    const pendingCompletion = new Promise<{
      from: number
      options: { label: string }[]
    }>((resolve) => {
      resolveCompletion = resolve
    })
    const view = new EditorView({
      state: EditorState.create({
        doc: 'wid',
        selection: { anchor: 3 },
        extensions: [
          autocompletion({
            interactionDelay: 0,
            override: [() => pendingCompletion],
          }),
          createCommandBarKclInputPendingEnterExtension({ onSubmit }),
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
    expect(enter.run?.(view)).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(view.state.doc.toString()).toBe('wid')

    resolveCompletion?.({
      from: 0,
      options: [{ label: 'width' }],
    })
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe('width')
    })
    expect(onSubmit).not.toHaveBeenCalled()
    view.destroy()
  })

  it('submits once if pending autocomplete finds no suggestions', async () => {
    const onSubmit = vi.fn()
    let resolveCompletion: ((result: null) => void) | undefined
    const pendingCompletion = new Promise<null>((resolve) => {
      resolveCompletion = resolve
    })
    const view = new EditorView({
      state: EditorState.create({
        doc: 'wid',
        selection: { anchor: 3 },
        extensions: [
          autocompletion({
            interactionDelay: 0,
            override: [() => pendingCompletion],
          }),
          createCommandBarKclInputPendingEnterExtension({ onSubmit }),
        ],
      }),
    })
    const [enter] = createCommandBarKclInputKeymap({
      onSubmit,
      stepBack: vi.fn(),
    })

    expect(startCompletion(view)).toBe(true)
    expect(enter.run?.(view)).toBe(true)
    expect(enter.run?.(view)).toBe(true)
    resolveCompletion?.(null)

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce()
    })
    view.destroy()
  })
})
