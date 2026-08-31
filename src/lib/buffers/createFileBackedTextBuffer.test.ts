import { history, redo, undo, undoDepth } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type EditorCapability,
  combineCapabilities,
} from '@src/contracts/buffers'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'

const historyCapability: EditorCapability = {
  id: 'history',
  extension: () => history(),
}

function createBuffer(
  overrides: Partial<Parameters<typeof createFileBackedTextBuffer>[0]> = {}
) {
  return createFileBackedTextBuffer({
    path: 'main.kcl',
    contents: 'thickness = 4',
    languageId: 'kcl',
    capabilities: combineCapabilities([historyCapability]),
    ...overrides,
  })
}

/** Append text through the dispatch boundary, as a command would. */
function append(
  buffer: ReturnType<typeof createBuffer>,
  text: string,
  origin: 'user' | 'command' | 'semantic' = 'command'
) {
  buffer.dispatch({
    changes: { from: buffer.state.peek().doc.length, insert: text },
    annotations: bufferOrigin.of(origin),
    userEvent: 'input',
  })
}

describe('buffer identity', () => {
  it('has an id that is not derived from the path', () => {
    const buffer = createBuffer()
    expect(buffer.id).not.toContain('main.kcl')
    expect(createBuffer().id).not.toBe(buffer.id)
  })

  it('keeps its id across a rename, and bumps the path revision', () => {
    const buffer = createBuffer()
    const { id } = buffer

    buffer.setPath('renamed.kcl')

    // A rename moves a buffer; it does not replace it. Background work holding
    // this reference has to survive the move.
    expect(buffer.id).toBe(id)
    expect(buffer.path.value).toBe('renamed.kcl')
    expect(buffer.name.value).toBe('renamed.kcl')
    expect(buffer.pathRevision.value).toBe(1)
  })

  it('does not bump the path revision when the path is unchanged', () => {
    const buffer = createBuffer()
    buffer.setPath('main.kcl')
    expect(buffer.pathRevision.value).toBe(0)
  })

  it('treats a null path as a scratch buffer', () => {
    const buffer = createBuffer({ path: null })
    expect(buffer.fileBacked.value).toBe(false)
    expect(buffer.name.value).toBe('Untitled')
    expect(buffer.structuralContext.value.fileBacked).toBe(false)
  })
})

describe('the dispatch boundary', () => {
  it('applies a change and advances the version', () => {
    const buffer = createBuffer()
    append(buffer, '\nwidth = 60')

    expect(buffer.text.value).toBe('thickness = 4\nwidth = 60')
    expect(buffer.version.value).toBe(1)
  })

  it('applies several specs in sequence, not from a shared base', () => {
    const buffer = createBuffer({ contents: '' })

    buffer.dispatch(
      { changes: { from: 0, insert: 'a' } },
      // If both specs were built from the same base state this would throw or
      // produce 'b', rather than appending after 'a'.
      { changes: { from: 1, insert: 'b' } }
    )

    expect(buffer.text.value).toBe('ab')
  })

  it('does not advance the version for a change-free transaction', () => {
    const buffer = createBuffer()
    buffer.dispatch({ selection: { anchor: 0 } })
    expect(buffer.version.value).toBe(0)
  })

  it('publishes every transaction with its origin', () => {
    const buffer = createBuffer()
    const seen: string[] = []
    buffer.onChange((change) => seen.push(change.origin))

    append(buffer, 'x', 'command')
    append(buffer, 'y', 'semantic')

    expect(seen).toEqual(['command', 'semantic'])
  })

  /**
   * The attributed edit stream, which is what makes a second writer in the
   * document representable. It rides the annotation that already exists rather
   * than a channel around the buffer, so every writer is attributable by
   * construction — there is no path that could forget to say who it was.
   */
  it('publishes the collaborator and contribution behind a change', () => {
    const buffer = createBuffer()
    const seen: { origin: string; author?: string; contributionId?: string }[] =
      []
    buffer.onChange((change) =>
      seen.push({
        origin: change.origin,
        author: change.author,
        contributionId: change.contributionId,
      })
    )

    buffer.dispatch({
      changes: { from: 0, insert: 'depth = 2\n' },
      annotations: bufferOrigin.of({
        role: 'semantic',
        author: 'zookeeper:conversation-1',
        contributionId: 'turn-7',
      }),
    })

    expect(seen).toEqual([
      {
        origin: 'semantic',
        author: 'zookeeper:conversation-1',
        contributionId: 'turn-7',
      },
    ])
  })

  /**
   * Every existing caller annotates with a bare role, and none of them had to
   * change — which is the point of leaving `origin` a string and adding identity
   * beside it rather than widening the role union.
   */
  it('leaves a bare role unattributed', () => {
    const buffer = createBuffer()
    const seen: { author?: string; contributionId?: string }[] = []
    buffer.onChange((change) =>
      seen.push({
        author: change.author,
        contributionId: change.contributionId,
      })
    )

    append(buffer, 'x', 'semantic')

    expect(seen).toEqual([{ author: undefined, contributionId: undefined }])
  })

  it('still reports the role when a structured origin omits the identity', () => {
    const buffer = createBuffer()
    const seen: string[] = []
    buffer.onChange((change) => seen.push(change.origin))

    buffer.dispatch({
      changes: { from: 0, insert: 'x' },
      annotations: bufferOrigin.of({ role: 'reconcile' }),
    })

    expect(seen).toEqual(['reconcile'])
  })

  it('keeps publishing after one listener throws', () => {
    const buffer = createBuffer()
    const good = vi.fn()
    buffer.onChange(() => {
      throw new Error('bad observer')
    })
    buffer.onChange(good)

    append(buffer, 'x')
    expect(good).toHaveBeenCalledTimes(1)
  })

  it('stops notifying a removed listener', () => {
    const buffer = createBuffer()
    const listener = vi.fn()
    const stop = buffer.onChange(listener)

    stop()
    append(buffer, 'x')
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('history without a view', () => {
  it('undoes and redoes with nothing mounted', () => {
    const buffer = createBuffer()
    append(buffer, '\nwidth = 60')
    expect(buffer.text.value).toContain('width = 60')

    // The point of the whole design: the document and its history live in the
    // buffer, so closing the pane cannot take undo away.
    expect(buffer.hasView.value).toBe(false)
    expect(buffer.runCommand(undo)).toBe(true)
    expect(buffer.text.value).toBe('thickness = 4')

    expect(buffer.runCommand(redo)).toBe(true)
    expect(buffer.text.value).toContain('width = 60')
  })

  it('reports false when there is nothing to undo', () => {
    expect(createBuffer().runCommand(undo)).toBe(false)
  })

  it('does not put a reconciliation in the undo stack', () => {
    const buffer = createBuffer()
    buffer.reconcile('from disk')

    // Adopting the file's version is not an editor action, so Ctrl-Z must not
    // "undo" it back to stale content.
    expect(buffer.runCommand(undo)).toBe(false)
    expect(buffer.text.value).toBe('from disk')
  })
})

describe('dirty state and saving', () => {
  let buffer: ReturnType<typeof createBuffer>

  beforeEach(() => {
    buffer = createBuffer()
  })

  it('starts clean, since the document matches the file', () => {
    expect(buffer.dirty.value).toBe(false)
  })

  it('becomes dirty on an edit and clean again when saved', () => {
    append(buffer, '!')
    expect(buffer.dirty.value).toBe(true)

    expect(
      buffer.markSaved({
        version: buffer.version.value,
        content: buffer.text.value,
      })
    ).toBe(true)
    expect(buffer.dirty.value).toBe(false)
  })

  it('is clean again if an edit is reverted back to the file content', () => {
    append(buffer, '!')
    buffer.runCommand(undo)
    // Dirty is a content comparison, not a flag, so this falls out for free.
    expect(buffer.dirty.value).toBe(false)
  })

  it('rejects a save that completed after a newer edit', () => {
    append(buffer, 'first')
    const staleVersion = buffer.version.value
    const staleContent = buffer.text.value

    append(buffer, 'second')

    // Accepting this would report a buffer with unsaved work as clean.
    expect(
      buffer.markSaved({ version: staleVersion, content: staleContent })
    ).toBe(false)
    expect(buffer.dirty.value).toBe(true)
  })

  it('records the version the base was captured at', () => {
    append(buffer, '!')
    buffer.markSaved({
      version: buffer.version.value,
      content: buffer.text.value,
    })
    expect(buffer.baseVersion.value).toBe(buffer.version.value)
  })
})

describe('reconciling external changes', () => {
  it('adopts an external change into a clean buffer', () => {
    const buffer = createBuffer()
    const outcome = buffer.reconcile('changed on disk')

    expect(outcome.kind).toBe('adopted')
    expect(buffer.text.value).toBe('changed on disk')
    expect(buffer.dirty.value).toBe(false)
  })

  it('reports an identical external change as unchanged', () => {
    const buffer = createBuffer()
    expect(buffer.reconcile('thickness = 4').kind).toBe('unchanged')
    expect(buffer.version.value).toBe(0)
  })

  it('never overwrites unsaved edits', () => {
    const buffer = createBuffer()
    append(buffer, ' // mine')

    const outcome = buffer.reconcile('someone else edited this')

    // Losing typed work silently is the worst available outcome, so the
    // conflict is recorded and the document left alone.
    expect(outcome.kind).toBe('diverged')
    expect(buffer.text.value).toBe('thickness = 4 // mine')
    expect(buffer.divergence.value).toBe('someone else edited this')
  })

  it('lets an accepted divergence be undone, unlike automatic adoption', () => {
    const buffer = createBuffer()
    append(buffer, ' // mine')
    buffer.reconcile('theirs')
    buffer.acceptDivergence()

    // Accepting discards typed work at the user's request, so undo is the
    // escape hatch. Automatic adoption is different and stays out of history.
    expect(buffer.runCommand(undo)).toBe(true)
    expect(buffer.text.value).toBe('thickness = 4 // mine')
  })

  it('can accept the incoming version', () => {
    const buffer = createBuffer()
    append(buffer, ' // mine')
    buffer.reconcile('theirs')

    buffer.acceptDivergence()
    expect(buffer.text.value).toBe('theirs')
    expect(buffer.dirty.value).toBe(false)
    expect(buffer.divergence.value).toBeNull()
  })

  it('can keep local edits and forget the divergence', () => {
    const buffer = createBuffer()
    append(buffer, ' // mine')
    buffer.reconcile('theirs')

    buffer.dismissDivergence()
    expect(buffer.text.value).toBe('thickness = 4 // mine')
    expect(buffer.dirty.value).toBe(true)
    expect(buffer.divergence.value).toBeNull()
  })

  it('clears a divergence once the buffer is saved', () => {
    const buffer = createBuffer()
    append(buffer, ' // mine')
    buffer.reconcile('theirs')

    buffer.markSaved({
      version: buffer.version.value,
      content: buffer.text.value,
    })
    expect(buffer.divergence.value).toBeNull()
  })
})

describe('snapshots', () => {
  it('captures content, identity, and versions', () => {
    const buffer = createBuffer()
    append(buffer, '!')

    const snapshot = buffer.snapshot()
    expect(snapshot).toMatchObject({
      bufferId: buffer.id,
      path: 'main.kcl',
      version: 1,
      pathRevision: 0,
      languageId: 'kcl',
      content: 'thickness = 4!',
      dirty: true,
    })
    expect(snapshot.contentId).toBeTruthy()
  })

  it('stays valid while the buffer keeps changing', () => {
    const buffer = createBuffer()
    const snapshot = buffer.snapshot()

    append(buffer, ' more typing')

    // CodeMirror documents are persistent, so the capture is immutable without
    // a copy — which is what makes "no save all" possible.
    expect(snapshot.content).toBe('thickness = 4')
    expect(snapshot.doc.toString()).toBe('thickness = 4')
    expect(buffer.text.value).toBe('thickness = 4 more typing')
  })

  it('gives different content different identities', () => {
    const buffer = createBuffer()
    const before = buffer.snapshot().contentId
    append(buffer, '!')
    expect(buffer.snapshot().contentId).not.toBe(before)
  })
})

describe('capabilities', () => {
  it('resolves in deterministic order regardless of contribution order', () => {
    const resolver = combineCapabilities([
      { id: 'late', order: 10, extension: () => [] },
      { id: 'early', order: -10, extension: () => [] },
      { id: 'middle', extension: () => [] },
    ])

    expect(resolver.capabilities.map((c) => c.id)).toEqual([
      'early',
      'middle',
      'late',
    ])
  })

  it('breaks order ties by id, so the result never depends on import order', () => {
    const resolver = combineCapabilities([
      { id: 'b', extension: () => [] },
      { id: 'a', extension: () => [] },
    ])
    expect(resolver.capabilities.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('lets a later contribution replace an earlier one with the same id', () => {
    const resolver = combineCapabilities([
      { id: 'shared', extension: () => [] },
      { id: 'shared', order: 5, extension: () => [] },
    ])

    expect(resolver.capabilities).toHaveLength(1)
    expect(resolver.capabilities[0].order).toBe(5)
  })

  it('applies only the capabilities that match the context', () => {
    const resolver = combineCapabilities([
      { id: 'always', extension: () => [] },
      {
        id: 'kcl-only',
        appliesTo: (context) => context.languageId === 'kcl',
        extension: () => [],
      },
    ])

    expect(
      resolver.resolve({
        bufferId: 'b',
        path: 'a.md',
        languageId: 'markdown',
        fileBacked: true,
        executing: false,
        readOnly: false,
      })
    ).toHaveLength(1)
  })

  it('rebuilds the bundle when the structural context changes', () => {
    const extension = vi.fn(() => [])
    const buffer = createFileBackedTextBuffer({
      path: 'main.kcl',
      contents: '',
      languageId: 'kcl',
      capabilities: combineCapabilities([{ id: 'watched', extension }]),
    })

    expect(extension).toHaveBeenCalledTimes(1)

    buffer.setExecuting(true)
    expect(extension).toHaveBeenCalledTimes(2)
    expect(extension).toHaveBeenLastCalledWith(
      expect.objectContaining({ executing: true })
    )
  })

  it('does not rebuild the bundle for an edit', () => {
    const extension = vi.fn(() => [])
    const buffer = createFileBackedTextBuffer({
      path: 'main.kcl',
      contents: '',
      languageId: 'kcl',
      capabilities: combineCapabilities([{ id: 'watched', extension }]),
    })

    append(buffer, 'typing')
    append(buffer, ' more')

    // The whole reason structural and volatile state are separated: typing must
    // never reconfigure the editor.
    expect(extension).toHaveBeenCalledTimes(1)
  })

  it('does not rebuild the bundle when a structural value is set to itself', () => {
    const extension = vi.fn(() => [])
    const buffer = createFileBackedTextBuffer({
      path: 'main.kcl',
      contents: '',
      languageId: 'kcl',
      capabilities: combineCapabilities([{ id: 'watched', extension }]),
    })

    buffer.setExecuting(false)
    buffer.setReadOnly(false)
    expect(extension).toHaveBeenCalledTimes(1)
  })

  it('binds live capabilities and disposes them with the buffer', () => {
    const dispose = vi.fn()
    const bind = vi.fn(() => dispose)
    const buffer = createFileBackedTextBuffer({
      path: 'main.kcl',
      contents: '',
      languageId: 'kcl',
      capabilities: combineCapabilities([{ id: 'bound', bind }]),
    })

    expect(bind).toHaveBeenCalledTimes(1)

    buffer.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('rebinds when the structural context changes', () => {
    const dispose = vi.fn()
    const buffer = createFileBackedTextBuffer({
      path: 'main.kcl',
      contents: '',
      languageId: 'kcl',
      capabilities: combineCapabilities([{ id: 'bound', bind: () => dispose }]),
    })

    // A buffer that becomes read-only should lose its autosave rather than keep
    // writing, so bindings are structural too.
    buffer.setReadOnly(true)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('enforces read-only through a capability', () => {
    const buffer = createFileBackedTextBuffer({
      path: 'main.kcl',
      contents: 'locked',
      languageId: 'kcl',
      readOnly: true,
      capabilities: combineCapabilities([
        {
          id: 'readonly',
          appliesTo: (context) => context.readOnly,
          extension: () => EditorState.readOnly.of(true),
        },
      ]),
    })

    expect(buffer.state.value.readOnly).toBe(true)
  })
})

describe('a disposed buffer', () => {
  it('accepts no further change', () => {
    const buffer = createBuffer()
    append(buffer, ' // one')
    const text = buffer.text.peek()
    const version = buffer.version.peek()

    buffer.dispose()
    append(buffer, ' // two')

    expect(buffer.text.peek()).toBe(text)
    expect(buffer.version.peek()).toBe(version)
  })

  /**
   * The failure this prevents: a history entry holding a closed buffer would
   * walk its document backwards with the persistence binding already released,
   * so the file would keep content the document no longer had and nothing would
   * report it.
   */
  it('declines a command instead of running it against nothing', () => {
    const buffer = createBuffer()
    append(buffer, ' // typed')
    buffer.dispose()

    expect(buffer.runCommand(undo)).toBe(false)
    expect(buffer.text.peek()).toContain('// typed')
  })

  it('says that it is disposed', () => {
    const buffer = createBuffer()
    expect(buffer.disposed.value).toBe(false)
    buffer.dispose()
    expect(buffer.disposed.value).toBe(true)
  })

  it('still answers questions about the document it held', () => {
    const buffer = createBuffer()
    buffer.dispose()

    expect(buffer.text.peek()).toBe('thickness = 4')
    expect(buffer.snapshot().content).toBe('thickness = 4')
  })

  it('can be disposed twice', () => {
    const buffer = createBuffer()
    buffer.dispose()
    expect(() => buffer.dispose()).not.toThrow()
  })
})

describe('adopting an external change', () => {
  /**
   * Adopting is dispatched with `addToHistory` false, which keeps it out of the
   * undo stack — but CodeMirror still *maps* every existing history event
   * through the change. A wholesale replacement mapped the user's own history
   * through a delete-everything, which dropped it.
   */
  it('leaves the undo history intact', () => {
    const buffer = createBuffer()
    append(buffer, '\nwidth = 2')
    buffer.markSaved({
      version: buffer.version.peek(),
      content: buffer.text.peek(),
    })
    expect(undoDepth(buffer.state.peek())).toBe(1)

    // Someone appended a line in another editor.
    expect(buffer.reconcile('thickness = 4\nwidth = 2\ndepth = 9').kind).toBe(
      'adopted'
    )

    expect(undoDepth(buffer.state.peek())).toBe(1)
  })

  it('undoes the edit and keeps what arrived', () => {
    const buffer = createBuffer()
    append(buffer, '\nwidth = 2')
    buffer.markSaved({
      version: buffer.version.peek(),
      content: buffer.text.peek(),
    })
    buffer.reconcile('thickness = 4\nwidth = 2\ndepth = 9')

    expect(buffer.runCommand(undo)).toBe(true)

    // The typed line is gone; the line that arrived from disk is not.
    expect(buffer.text.peek()).toBe('thickness = 4\ndepth = 9')
  })

  it('treats an identical file as nothing having happened', () => {
    const buffer = createBuffer()
    const version = buffer.version.peek()

    expect(buffer.reconcile('thickness = 4').kind).toBe('unchanged')
    expect(buffer.version.peek()).toBe(version)
  })
})
