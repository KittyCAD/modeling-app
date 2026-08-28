import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { autoConnectOnProjectOpen } from '@src/features/engine/autoConnect'

const harness = (
  overrides: {
    project?: string | null
    executing?: boolean
    signedIn?: boolean
    offline?: boolean
  } = {}
) => {
  const project = signal<string | null>(overrides.project ?? null)
  const executing = signal(overrides.executing ?? true)
  const signedIn = signal(overrides.signedIn ?? true)
  const offline = signal(overrides.offline ?? true)
  const connect = vi.fn(async () => {})

  const stop = autoConnectOnProjectOpen({
    project,
    executing,
    signedIn,
    offline,
    connect,
  })

  return { project, executing, signedIn, offline, connect, stop }
}

describe('connecting when a project opens', () => {
  it('connects for a project that has something to render', () => {
    const app = harness()

    app.project.value = 'local:/projects/bracket'

    expect(app.connect).toHaveBeenCalledTimes(1)
    app.stop()
  })

  it('waits for a buffer to execute', () => {
    const app = harness({ executing: false })

    app.project.value = 'local:/projects/empty'
    expect(app.connect).not.toHaveBeenCalled()

    // Opening a KCL file later is the same intention, arriving late.
    app.executing.value = true
    expect(app.connect).toHaveBeenCalledTimes(1)
    app.stop()
  })

  /*
   * The app is usable signed out, and the engine's own command is what asks for
   * an account. Opening a project must not put a sign-in screen on launch.
   */
  it('does not connect, or ask for an account, when signed out', () => {
    const app = harness({ signedIn: false })

    app.project.value = 'local:/projects/bracket'

    expect(app.connect).not.toHaveBeenCalled()
    app.stop()
  })

  it('connects once, not on every change to the project', () => {
    const app = harness()
    app.project.value = 'local:/projects/bracket'

    app.executing.value = false
    app.executing.value = true

    expect(app.connect).toHaveBeenCalledTimes(1)
    app.stop()
  })

  it('leaves an explicit disconnect disconnected', () => {
    const app = harness()
    app.project.value = 'local:/projects/bracket'
    app.offline.value = false

    // Someone hit disconnect: back to offline, with the project still open.
    app.offline.value = true

    expect(app.connect).toHaveBeenCalledTimes(1)
    app.stop()
  })

  it('does not retry a failed attempt in a loop', () => {
    const app = harness()
    app.project.value = 'local:/projects/bracket'

    // A failure leaves the connection reporting `failed`, then offline again.
    app.offline.value = false
    app.offline.value = true

    expect(app.connect).toHaveBeenCalledTimes(1)
    app.stop()
  })

  it('connects again for a different project', () => {
    const app = harness()
    app.project.value = 'local:/projects/bracket'
    app.project.value = 'local:/projects/flange'

    expect(app.connect).toHaveBeenCalledTimes(2)
    app.stop()
  })

  it('connects again when the same project is reopened', () => {
    const app = harness()
    app.project.value = 'local:/projects/bracket'
    app.project.value = null
    app.project.value = 'local:/projects/bracket'

    expect(app.connect).toHaveBeenCalledTimes(2)
    app.stop()
  })

  it('does nothing at all with no project open', () => {
    const app = harness()

    app.executing.value = false
    app.signedIn.value = false
    app.signedIn.value = true

    expect(app.connect).not.toHaveBeenCalled()
    app.stop()
  })

  it('reports a rejected attempt rather than leaving it unhandled', async () => {
    const project = signal<string | null>(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stop = autoConnectOnProjectOpen({
      project,
      executing: signal(true),
      signedIn: signal(true),
      offline: signal(true),
      connect: () => Promise.reject(new Error('no route to host')),
    })

    project.value = 'local:/projects/bracket'
    await Promise.resolve()

    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    stop()
  })
})
