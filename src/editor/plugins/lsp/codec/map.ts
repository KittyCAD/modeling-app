export default class PromiseMap<K, V extends { toString(): string }> {
  #map: Map<K, PromiseMap.Entry<V>> = new Map()

  get(key: K & { toString(): string }): null | Promise<V> {
    let initialized: PromiseMap.Entry<V>
    // if the entry doesn't exist, set it
    if (!this.#map.has(key)) {
      initialized = this.#set(key)
    } else {
      // otherwise return the entry
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      initialized = this.#map.get(key)!
    }
    // if the entry is a pending promise, return it
    if (initialized.status === 'pending') {
      return initialized.promise
    } else {
      // otherwise return null
      return null
    }
  }

  #set(key: K, value?: V): PromiseMap.Entry<V> {
    if (this.#map.has(key)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return this.#map.get(key)!
    }
    // placeholder resolver for entry
    let resolve = (item: V) => {
      void item
    }
    // promise for entry (which assigns the resolver
    const promise = new Promise<V>((resolver) => {
      resolve = resolver
    })
    // the initialized entry
    const initialized: PromiseMap.Entry<V> = {
      status: 'pending',
      resolve,
      promise,
    }
    if (null != value) {
      initialized.resolve(value)
    }
    // set the entry
    this.#map.set(key, initialized)
    return initialized
  }

  set(key: K & { toString(): string }, value: V): this {
    const initialized = this.#set(key, value)
    // if the promise is pending ...
    if (initialized.status === 'pending') {
      // ... set the entry status to resolved to free the promise
      this.#map.set(key, { status: 'resolved' })
      // ... and resolve the promise with the given value
      initialized.resolve(value)
    }
    return this
  }

  get size(): number {
    return this.#map.size
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace PromiseMap {
  export type Entry<V> =
    | { status: 'pending'; resolve: (item: V) => void; promise: Promise<V> }
    | { status: 'resolved' }
}
