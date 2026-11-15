import { invertedEffects, isolateHistory } from '@codemirror/commands'
import { StateEffect, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { signal } from '@preact/signals-core'
import { expect, it, vi } from 'vitest'
import { createEditorDocument } from '@src/lib/editors/document'
import type { Editor } from '@src/lib/editors/registry/contract'
import { createModelingDocumentAdapter } from '@src/lib/kcl/machine/document'

const checkpoint = StateEffect.define<{ undo: number; redo: number }>()
function fixture() {
  const readOnly = signal(false)
  const backing = createEditorDocument('before', () => !readOnly.peek())
  const editor: Editor = {
    ...backing.document,
    get state() {
      return backing.document.state
    },
    id: Symbol(),
    src: signal('/main.kcl'),
    classification: signal({ languageId: 'kcl' }),
    readOnly,
  }
  const create = () => {
    const restored: number[] = [],
      external = vi.fn(),
      publish = vi.fn()
    const adapter = createModelingDocumentAdapter(editor, publish, external)
    const view = adapter.createView(
      [
        invertedEffects.of((tr) =>
          tr.effects.flatMap((effect) =>
            effect.is(checkpoint)
              ? [
                  checkpoint.of({
                    undo: effect.value.redo,
                    redo: effect.value.undo,
                  }),
                ]
              : []
          )
        ),
        EditorView.updateListener.of((update) => {
          for (const tr of update.transactions) {
            if (tr.isUserEvent('undo') || tr.isUserEvent('redo'))
              for (const effect of tr.effects)
                if (effect.is(checkpoint)) restored.push(effect.value.redo)
          }
        }),
      ],
      (effect) => effect.is(checkpoint)
    )
    return { adapter, view, restored, external, publish }
  }
  return { editor, readOnly, create, dispose: backing.dispose }
}

it('shares text and history but replays native checkpoint effects only in their owning view', () => {
  const document = fixture(),
    first = document.create(),
    second = document.create()
  try {
    first.view.dispatch({
      changes: { from: 0, to: 6, insert: 'after' },
      effects: checkpoint.of({ undo: 10, redo: 11 }),
      annotations: isolateHistory.of('full'),
    })
    expect(document.editor.contents.peek()).toBe('after')
    expect(second.view.state.doc.toString()).toBe('after')
    expect(second.external).toHaveBeenCalledOnce()
    expect(first.external).not.toHaveBeenCalled()
    expect(document.editor.undo()).toBe(true)
    expect(document.editor.contents.peek()).toBe('before')
    expect(first.view.state.doc.toString()).toBe('before')
    expect(second.view.state.doc.toString()).toBe('before')
    expect(first.restored).toEqual([10])
    expect(second.restored).toEqual([])
    expect(document.editor.redo()).toBe(true)
    expect(first.restored).toEqual([10, 11])
    expect(second.restored).toEqual([])
  } finally {
    first.adapter.dispose()
    second.adapter.dispose()
    document.dispose()
  }
})

it('keeps undo usable after the native checkpoint owner closes', () => {
  const document = fixture(),
    first = document.create(),
    second = document.create()
  try {
    first.view.dispatch({
      changes: { from: 0, to: 6, insert: 'after' },
      effects: checkpoint.of({ undo: 10, redo: 11 }),
    })
    first.adapter.dispose()
    expect(document.editor.undo()).toBe(true)
    expect(second.view.state.doc.toString()).toBe('before')
    expect(second.restored).toEqual([])
  } finally {
    first.adapter.dispose()
    second.adapter.dispose()
    document.dispose()
  }
})

it('publishes source before document observers run and rejects edits when read only or disposed', () => {
  const document = fixture(),
    first = document.create()
  const observed: string[] = []
  const stop = document.editor.subscribe(() =>
    observed.push(first.publish.mock.lastCall?.[0] ?? 'unpublished')
  )
  try {
    first.view.dispatch({ changes: { from: 0, to: 6, insert: 'after' } })
    expect(observed).toEqual(['after'])
    document.readOnly.value = true
    first.view.dispatch({ changes: { from: 0, insert: 'blocked' } })
    expect(document.editor.contents.peek()).toBe('after')
    document.readOnly.value = false
    first.adapter.dispose()
    document.editor.dispatch({
      changes: { from: 0, to: 5, insert: 'elsewhere' },
      annotations: Transaction.addToHistory.of(false),
    })
    expect(document.editor.contents.peek()).toBe('elsewhere')
    expect(first.publish).toHaveBeenCalledOnce()
  } finally {
    stop()
    first.adapter.dispose()
    document.dispose()
  }
})
