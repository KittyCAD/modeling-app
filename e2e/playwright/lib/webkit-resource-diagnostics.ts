// Runs before app scripts. Keep weak references so observing resources does not
// keep native sockets, workers, or peer connections alive. Never collect payloads.
export function installWebKitResourceDiagnostics() {
  if (Reflect.has(window, '__webkitResourceDiagnostics')) return
  const sockets: {
    ref: WeakRef<WebSocket>
    role: string
    createdMs: number
    openedMs?: number
    closedMs?: number
    lastMessageMs?: number
    opened: boolean
    closed: boolean
    code?: number
    messages: number
  }[] = []
  const workers: {
    ref: WeakRef<Worker>
    opfs: boolean
    terminated: boolean
    pending: Set<number>
    completed: number
  }[] = []
  const workerMetrics = new WeakMap<Worker, (typeof workers)[number]>()
  const peers: WeakRef<RTCPeerConnection>[] = []
  let pendingTransactions = 0
  let completedTransactions = 0
  let abortedTransactions = 0
  let socketsCreated = 0
  let workersCreated = 0
  let peersCreated = 0
  const installed: string[] = []
  const failed: string[] = []
  const install = (name: string, fn: () => void) => {
    try {
      fn()
      installed.push(name)
    } catch {
      failed.push(name)
    }
  }
  install('websocket', () => {
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget) as WebSocket
        socketsCreated++
        if (sockets.length < 64) {
          let role = 'other'
          try {
            const url = new URL(String(args[0]), location.href)
            role = url.pathname.includes('/ml/copilot')
              ? 'copilot'
              : url.pathname.includes('/modeling')
                ? 'engine'
                : url.hostname === location.hostname
                  ? 'local-development'
                  : 'other'
          } catch {}
          const entry = {
            ref: new WeakRef(socket),
            role,
            createdMs: Math.round(performance.now()),
            openedMs: undefined as number | undefined,
            closedMs: undefined as number | undefined,
            lastMessageMs: undefined as number | undefined,
            opened: false,
            closed: false,
            code: undefined as number | undefined,
            messages: 0,
          }
          sockets.push(entry)
          socket.addEventListener('open', () => {
            entry.opened = true
            entry.openedMs = Math.round(performance.now())
          })
          socket.addEventListener('close', (event) => {
            entry.closed = true
            entry.closedMs = Math.round(performance.now())
            entry.code = event.code
          })
          socket.addEventListener('message', () => {
            entry.messages++
            entry.lastMessageMs = Math.round(performance.now())
          })
        }
        return socket
      },
    })
  })
  install('worker', () => {
    window.Worker = new Proxy(window.Worker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker
        workersCreated++
        if (workers.length < 64) {
          const entry = {
            ref: new WeakRef(worker),
            opfs: args[1]?.name === 'opfs-write',
            terminated: false,
            pending: new Set<number>(),
            completed: 0,
          }
          workers.push(entry)
          workerMetrics.set(worker, entry)
          worker.addEventListener('message', (event: MessageEvent<unknown>) => {
            const data = event.data
            if (
              entry.opfs &&
              data &&
              typeof data === 'object' &&
              'id' in data &&
              typeof data.id === 'number' &&
              entry.pending.delete(data.id)
            ) {
              entry.completed++
            }
          })
        }
        return worker
      },
    })
    // Preserve the native receiver and all overload arguments.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const post = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (
      this: Worker,
      message: unknown,
      ...args: unknown[]
    ) {
      const entry = workerMetrics.get(this)
      if (
        entry?.opfs &&
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'write-file' &&
        'id' in message &&
        typeof message.id === 'number' &&
        entry.pending.size < 256
      ) {
        entry.pending.add(message.id)
      }
      return Reflect.apply(post, this, [message, ...args])
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const terminate = Worker.prototype.terminate
    Worker.prototype.terminate = function (this: Worker) {
      const entry = workerMetrics.get(this)
      if (entry) entry.terminated = true
      return terminate.call(this)
    }
  })
  install('peer-connection', () => {
    window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, {
      construct(target, args, newTarget) {
        const peer = Reflect.construct(
          target,
          args,
          newTarget
        ) as RTCPeerConnection
        peersCreated++
        if (peers.length < 64) peers.push(new WeakRef(peer))
        return peer
      },
    })
  })
  install('indexeddb', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const transaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const tx = Reflect.apply(transaction, this, args)
      pendingTransactions++
      tx.addEventListener(
        'complete',
        () => {
          pendingTransactions--
          completedTransactions++
        },
        { once: true }
      )
      tx.addEventListener(
        'abort',
        () => {
          pendingTransactions--
          abortedTransactions++
        },
        { once: true }
      )
      return tx
    }
  })
  Reflect.set(window, '__webkitResourceDiagnostics', {
    snapshot: () => ({
      installed,
      failed,
      coverage: {
        opfs: 'named-worker-messages',
        indexedDB: 'window-transactions',
      },
      socketsCreated,
      workersCreated,
      peersCreated,
      sockets: sockets.map((entry, id) => {
        const socket = entry.ref.deref()
        return {
          id,
          role: entry.role,
          createdMs: entry.createdMs,
          openedMs: entry.openedMs,
          closedMs: entry.closedMs,
          lastMessageMs: entry.lastMessageMs,
          opened: entry.opened,
          closed: entry.closed,
          code: entry.code,
          messages: entry.messages,
          collected: !socket,
          readyState: socket?.readyState,
          bufferedAmount: socket?.bufferedAmount,
        }
      }),
      workers: workers.map((entry) => ({
        opfs: entry.opfs,
        terminated: entry.terminated,
        collected: !entry.ref.deref(),
        pendingWrites: entry.pending.size,
        completedWrites: entry.completed,
      })),
      peers: peers.map((ref) => {
        const peer = ref.deref()
        return peer
          ? {
              connectionState: peer.connectionState,
              iceConnectionState: peer.iceConnectionState,
              signalingState: peer.signalingState,
              tracks: peer.getReceivers().map((receiver) => ({
                kind: receiver.track.kind,
                readyState: receiver.track.readyState,
              })),
            }
          : { collected: true }
      }),
      indexedDB: {
        pendingTransactions,
        completedTransactions,
        abortedTransactions,
      },
    }),
  })
}
