export class Signal {
  private _listeners: Array<() => void> = []

  add(listener: () => void) {
    this._listeners.push(listener)
    return () => {
      this.remove(listener)
    }
  }

  remove(listener: () => void): void {
    this._listeners = this._listeners.filter((l) => l !== listener)
  }

  dispatch(): void {
    for (const listener of this._listeners) {
      listener()
    }
  }
}
