import { Debugger } from '@src/lib/debugger'
import { describe, expect, it } from 'vitest'

describe('Debugger.snapshotForReport', () => {
  it('captures diagnostics without stacks or live metadata references', () => {
    const engineDebugger = new Debugger()
    const metadata = { id: 'connection-1', readyState: 1 }
    engineDebugger.addLog({ label: 'connection', message: 'open', metadata })

    const snapshot = engineDebugger.snapshotForReport(8192)
    metadata.readyState = 3
    engineDebugger.addLog({ label: 'connection', message: 'closed' })

    expect(snapshot).toEqual({
      logs: [
        {
          time: expect.any(Number),
          label: 'connection',
          message: 'open',
          metadata: { id: 'connection-1', readyState: 1 },
        },
      ],
      totalLogCount: 1,
      truncated: false,
    })
    expect(engineDebugger.logs[0].stack).toEqual(expect.any(String))
    expect(engineDebugger.logs).toHaveLength(2)
  })

  it('keeps at most 200 entries even with a larger caller budget', () => {
    const engineDebugger = new Debugger()
    for (let i = 0; i < 205; i++) {
      engineDebugger.addLog({ label: 'connection', message: `event-${i}` })
    }

    const snapshot = engineDebugger.snapshotForReport(64 * 1024)
    expect(snapshot.logs).toHaveLength(200)
    expect(snapshot.logs[0].message).toBe('event-5')
    expect(snapshot.logs.at(-1)?.message).toBe('event-204')
    expect(snapshot.totalLogCount).toBe(205)
    expect(snapshot.truncated).toBe(true)
  })

  it('bounds the serialized snapshot by characters, retaining the newest events', () => {
    const engineDebugger = new Debugger()
    for (let i = 0; i < 200; i++) {
      engineDebugger.addLog({
        label: `event-${i}`,
        message: '\u{1f680}'.repeat(400),
      })
    }

    const snapshot = engineDebugger.snapshotForReport(8192)
    expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(8192)
    expect(snapshot.logs.length).toBeGreaterThan(0)
    expect(snapshot.logs.length).toBeLessThan(200)
    expect(snapshot.logs.at(-1)?.label).toBe('event-199')
    expect(snapshot.truncated).toBe(true)
  })

  it('retains the newest event when its escaped metadata exceeds the character budget', () => {
    const engineDebugger = new Debugger()
    const hugeString = '\u0000'.repeat(100_000)
    engineDebugger.addLog({
      label: 'connection',
      message: hugeString,
      metadata: Object.fromEntries(
        [
          'id',
          'apiCallId',
          'type',
          'name',
          'message',
          'code',
          'codeSummarized',
          'reason',
          'readyState',
          'connectionState',
          'iceConnectionState',
          'iceGatheringState',
          'signalingState',
          'kind',
        ].map((key) => [key, hugeString])
      ),
    })

    const snapshot = engineDebugger.snapshotForReport(8192)
    expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(8192)
    expect(snapshot.logs).toHaveLength(1)
    expect(snapshot.logs[0].message).toContain('[Truncated]')
    expect(snapshot.logs[0].metadata).toBe('[Truncated]')
    expect(snapshot.truncated).toBe(true)
  })

  it('summarizes native events and errors without exporting unrelated metadata', () => {
    const engineDebugger = new Debugger()
    engineDebugger.addLog({
      label: 'connection',
      message: 'closed',
      metadata: {
        event: new CloseEvent('close', {
          code: 1006,
          reason: 'lost connection',
          wasClean: false,
        }),
        error: new Error('connection failed'),
        options: {
          websocketClosed: true,
          connectionError: { kind: 'backend_disconnect', terminal: true },
        },
        filePath: '/private/project/main.kcl',
        jsAppSettings: { theme: 'dark' },
        command: { source: 'private KCL' },
        candidate: { candidate: 'private ICE candidate' },
        token: 'private token',
      },
    })

    expect(engineDebugger.snapshotForReport(8192).logs[0].metadata).toEqual({
      event: {
        type: 'close',
        code: 1006,
        reason: 'lost connection',
        wasClean: false,
      },
      error: { name: 'Error', message: 'connection failed' },
      options: {
        websocketClosed: true,
        connectionError: { kind: 'backend_disconnect', terminal: true },
      },
    })
  })

  it('handles circular metadata, bigint, and throwing getters without invoking toJSON', () => {
    const engineDebugger = new Debugger()
    const metadata: Record<string, unknown> = { id: 'connection-1', code: 1n }
    metadata.error = metadata
    Object.defineProperty(metadata, 'event', {
      get() {
        throw new Error('unreadable event')
      },
    })
    metadata.toJSON = () => {
      throw new Error('must not call toJSON')
    }
    engineDebugger.addLog({ label: 'connection', message: 'failed', metadata })

    const snapshot = engineDebugger.snapshotForReport(8192)
    expect(() => JSON.stringify(snapshot)).not.toThrow()
    expect(snapshot.logs[0].metadata).toMatchObject({
      id: 'connection-1',
      code: null,
      event: '[Unavailable]',
    })
    expect(snapshot.truncated).toBe(true)
  })

  it('returns an empty snapshot before any events have been logged', () => {
    expect(new Debugger().snapshotForReport(8192)).toEqual({
      logs: [],
      totalLogCount: 0,
      truncated: false,
    })
  })
})
