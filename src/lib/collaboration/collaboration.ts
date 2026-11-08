import * as A from '@automerge/automerge'
import {
  Repo,
  type DocHandle,
  type DocumentId,
} from '@automerge/automerge-repo'
import { Transaction } from '@codemirror/state'
import { diff } from '@codemirror/merge'
import { signal } from '@preact/signals-core'
import type {
  Editor,
  EditorResourceHost,
} from '@src/lib/editors/registry/contract'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type {
  CollaborativeText,
  CollaborationService,
  CollaborationState,
} from '@src/lib/collaboration/registry/contract'
import {
  projectHistoryStorage,
  type HistoryEntry,
} from '@src/lib/collaboration/storage'
import fsZds from '@src/lib/fs-zds'
import { isErr, reportRejection } from '@src/lib/trap'

/** Each project opening captures its storage root; queued writes cannot migrate to another project. */
export function createCollaboration(
  getSession: () => OpenProjectSession | undefined,
  getOperations: () => FileOperationsRegistryService
) {
  type Store = ReturnType<typeof makeStore>
  type Record = {
    handle: DocHandle<CollaborativeText>
    metadata: HistoryEntry
    store: Store
    stop: () => void
    timer?: ReturnType<typeof setTimeout>
  }
  const stores = new Set<Store>()
  const bySession = new WeakMap<OpenProjectSession, Store>()
  const latestRoot = new Map<string, Store>()
  const entries = new WeakMap<Editor, ReturnType<typeof makeEntry>>()
  const active = new Set<ReturnType<typeof makeEntry>>()
  let memory: Store | undefined
  let disposed = false

  function makeStore(session?: OpenProjectSession) {
    const repo = new Repo({ network: [] })
    const root = session?.project.peek().contents.path
    const previous = root ? latestRoot.get(root) : undefined
    const storage = session
      ? projectHistoryStorage(
          getOperations(),
          session.project.peek().contents.path,
          session.project.peek().metadata.readWriteAccess
        )
      : undefined
    const persisted = new Map<string, HistoryEntry>()
    const index = (async () => {
      // A rapid close/reopen of the same root must observe its final queued snapshot.
      await Promise.resolve()
      if (previous) {
        for (const record of previous.records.values())
          if (record.timer) persist(record)
        await previous.pending
      }
      const index = await (storage?.readIndex() ??
        Promise.resolve([] as HistoryEntry[]))
      for (const item of index) persisted.set(item.id, { ...item })
      return index
    })()
    // Observed immediately, then propagated to each binding without creating a floating rejection.
    void index.catch(() => {})
    const store = {
      repo,
      root,
      storage,
      persisted,
      errors: new Map<string, Error>(),
      index,
      records: new Map<string, Record>(),
      claimed: new Set<string>(),
      pending: Promise.resolve(),
      session,
    }
    stores.add(store)
    if (root) latestRoot.set(root, store)
    session?.signal.addEventListener(
      'abort',
      () => {
        // Editor teardown runs in the same abort turn; drain its final writes before releasing the repo.
        queueMicrotask(() => {
          for (const record of store.records.values()) {
            persist(record)
            record.stop()
          }
          void store.pending
            .then(() => repo.shutdown())
            .then(() => {
              stores.delete(store)
              if (root && latestRoot.get(root) === store)
                latestRoot.delete(root)
            })
            .catch(reportRejection)
        })
      },
      { once: true }
    )
    return store
  }
  function storeFor() {
    const session = getSession()
    if (!session) return (memory ??= makeStore())
    let store = bySession.get(session)
    if (!store) {
      store = makeStore(session)
      bySession.set(session, store)
    }
    return store
  }
  function publishError(record: Record, error: Error) {
    for (const entry of active)
      if (entry.record === record)
        entry.state.value = {
          status: 'ready',
          documentId: record.handle.documentId,
          durable: false,
          error,
        }
  }
  function persist(record: Record) {
    if (record.timer) clearTimeout(record.timer)
    record.timer = undefined
    if (!record.store.storage?.writable) return
    const bytes = A.save(record.handle.doc())
    const store = record.store
    const metadata = { ...record.metadata }
    const next = store.pending.then(async () => {
      await store.index
      const index = new Map(store.persisted)
      index.set(metadata.id, metadata)
      await store.storage!.write(metadata.id, bytes, [...index.values()])
      store.persisted.set(metadata.id, metadata)
      store.errors.delete(metadata.id)
      for (const entry of active)
        if (entry.record === record)
          entry.state.value = {
            status: 'ready',
            documentId: record.handle.documentId,
            durable: true,
          }
    })
    store.pending = next.catch((cause) => {
      const error = isErr(cause) ? cause : new Error(String(cause))
      store.errors.set(record.metadata.id, error)
      publishError(record, error)
    })
  }
  function schedule(record: Record) {
    if (record.timer) clearTimeout(record.timer)
    record.timer = setTimeout(() => persist(record), 150)
  }
  function locator(store: Store, src: string | undefined) {
    return src && store.root ? fsZds.relative(store.root, src) : src
  }
  async function connect(editor: Editor, store: Store): Promise<Record> {
    const initialContents = editor.contents.peek()
    const src = locator(store, editor.src.peek())
    const index = await store.index
    if (disposed || store.session?.signal.aborted)
      return Promise.reject(
        new Error('The project closed before collaboration loaded')
      )
    const restored = src
      ? index.find((item) => item.src === src && !store.claimed.has(item.id))
      : undefined
    if (restored) store.claimed.add(restored.id)
    const existing = restored && store.records.get(restored.id)
    const handle = existing
      ? existing.handle
      : restored
        ? store.repo.import<CollaborativeText>(
            await store.storage!.read(restored.id),
            { docId: restored.id as DocumentId }
          )
        : store.repo.create<CollaborativeText>({ text: initialContents })
    await handle.whenReady()
    if (typeof handle.doc()?.text !== 'string')
      return Promise.reject(
        new Error('Collaboration history does not contain a text buffer')
      )
    const metadata = restored ?? {
      id: handle.documentId,
      src,
      diskText: initialContents,
    }
    if (!restored) {
      index.push(metadata)
      store.claimed.add(metadata.id)
    }
    // Disk changes made outside the app become a new CRDT edit; unchanged disk recovers the draft.
    if (restored && metadata.diskText !== initialContents) {
      handle.change((doc: CollaborativeText) =>
        A.updateText(doc, ['text'], initialContents)
      )
      metadata.diskText = initialContents
    }
    if (existing) return existing
    const record: Record = { handle, metadata, store, stop: () => {} }
    const changed = () => schedule(record)
    handle.on('change', changed)
    record.stop = () => handle.off('change', changed)
    store.records.set(metadata.id, record)
    return record
  }
  function makeEntry(editor: Editor) {
    const state = signal<CollaborationState>({ status: 'loading' })
    const initial = editor.contents.peek()
    const store = storeFor()
    const promise = connect(editor, store)
    const entry = {
      editor,
      state,
      initial,
      promise,
      record: undefined as Record | undefined,
      closed: false,
      attached: Promise.resolve(),
    }
    active.add(entry)
    return entry
  }
  function entryFor(editor: Editor) {
    let entry = entries.get(editor)
    if (!entry) {
      entry = makeEntry(editor)
      entries.set(editor, entry)
    }
    return entry
  }
  const service: CollaborationService = {
    state: (editor) => entryFor(editor).state,
    ready: async (editor) => {
      const entry = entryFor(editor)
      const record = await entry.promise
      await entry.attached
      if (entry.closed || entry.state.value.status !== 'ready')
        return Promise.reject(
          new Error('Collaboration is unavailable for this editor')
        )
      return record.handle
    },
    flush: async () => {
      await Promise.allSettled([...active].map((entry) => entry.attached))
      for (const store of stores)
        for (const record of store.records.values())
          if (record.timer) persist(record)
      await Promise.all([...stores].map((store) => store.pending))
      const error = [...stores].flatMap((store) => [
        ...store.errors.values(),
      ])[0]
      if (error) return Promise.reject(error)
    },
  }
  return {
    service,
    checkpoint: async (editor: Editor, src: string, contents: string) => {
      const entry = entryFor(editor)
      const record = await entry.promise
      record.metadata.src = locator(record.store, src)
      record.metadata.diskText = contents
      persist(record)
      await record.store.pending
    },
    setup: ({ editor, onDispose }: EditorResourceHost) => {
      const entry = entryFor(editor)
      let alive = true
      let reconciling = false
      let stopChanges = () => {}
      const unsubscribe = editor.src.subscribe((src) => {
        if (entry.record) {
          entry.record.metadata.src = locator(entry.record.store, src)
          schedule(entry.record)
        }
      })
      onDispose(() => {
        alive = false
        entry.closed = true
        active.delete(entry)
        unsubscribe()
        stopChanges()
        if (entry.record) {
          persist(entry.record)
          if (![...active].some((other) => other.record === entry.record))
            entry.record.store.claimed.delete(entry.record.metadata.id)
        }
      })
      entry.attached = entry.promise
        .then((record) => {
          if (!alive || disposed || record.store.session?.signal.aborted) {
            if (![...active].some((entry) => entry.record === record))
              record.store.claimed.delete(record.metadata.id)
            return
          }
          entry.record = record
          record.metadata.src = locator(record.store, editor.src.peek())
          if (editor.contents.peek() !== entry.initial)
            record.handle.change((doc: CollaborativeText) =>
              A.updateText(doc, ['text'], editor.contents.peek())
            )
          const reconcile = () => {
            const text = record.handle.doc()!.text
            const before = editor.contents.peek()
            if (before === text) return
            reconciling = true
            try {
              editor.dispatch({
                changes: diff(before, text).map((change) => ({
                  from: change.fromA,
                  to: change.toA,
                  insert: text.slice(change.fromB, change.toB),
                })),
                annotations: Transaction.addToHistory.of(false),
              })
            } finally {
              reconciling = false
            }
          }
          reconcile()
          record.handle.on('change', reconcile)
          const stop = editor.subscribe((transaction) => {
            if (!reconciling && transaction.docChanged)
              record.handle.change((doc: CollaborativeText) =>
                A.updateText(doc, ['text'], transaction.state.doc.toString())
              )
          })
          stopChanges = () => {
            stop()
            record.handle.off('change', reconcile)
          }
          entry.state.value = {
            status: 'ready',
            documentId: record.handle.documentId,
            durable: !!record.store.storage?.writable,
          }
          schedule(record)
        })
        .catch((cause) => {
          if (alive)
            entry.state.value = {
              status: 'error',
              error: isErr(cause) ? cause : new Error(String(cause)),
            }
        })
    },
    dispose: () => {
      disposed = true
      for (const store of stores)
        for (const record of store.records.values()) {
          persist(record)
          record.stop()
        }
      void service
        .flush()
        .then(() =>
          Promise.all([...stores].map((store) => store.repo.shutdown()))
        )
        .catch(reportRejection)
    },
  }
}
