export type AbortableDeviceFlowHandle = {
  abort: () => void
}

export type DeviceFlowSession<
  Handle extends AbortableDeviceFlowHandle = AbortableDeviceFlowHandle,
> = {
  handle: Handle
  verificationUri: string
}

export class DeviceFlowSessionStore<
  WindowKey extends object,
  Handle extends AbortableDeviceFlowHandle = AbortableDeviceFlowHandle,
> {
  private readonly sessions = new WeakMap<
    WindowKey,
    DeviceFlowSession<Handle>
  >()

  get(window: WindowKey | undefined): DeviceFlowSession<Handle> | undefined {
    return window ? this.sessions.get(window) : undefined
  }

  set(window: WindowKey, session: DeviceFlowSession<Handle>) {
    this.sessions.get(window)?.handle.abort()
    this.sessions.set(window, session)
  }

  abort(window: WindowKey) {
    this.sessions.get(window)?.handle.abort()
    this.sessions.delete(window)
  }

  deleteIfCurrent(window: WindowKey, session: DeviceFlowSession<Handle>) {
    if (this.sessions.get(window) === session) {
      this.sessions.delete(window)
    }
  }
}
