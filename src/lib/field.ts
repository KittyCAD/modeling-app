import { signal, Signal } from '@preact/signals-core'
import { Extension, ZDSFacet } from './facet'

export class FieldSet {
  #fields = new Map<string, Signal>()
  get<T>(field: Field<T>): T {
    const found = this.#fields.get(field.name)
    if (!found) {
      throw new Error(`Field ${field.name} not found in set`)
    }
    return found.value as T
  }

  add(field: Field) {
    const found = this.#fields.has(field.name)
    if (found) {
      throw new Error(
        `Field ${field.name} already found in set, cannot add again.`
      )
    }
    this.#fields.set(field.name, field.signal)
  }

  keys() {
    return this.#fields.keys()
  }
  entries() {
    return this.#fields.entries()
  }

  static fromFields(...fields: Field[]) {
    const set = new FieldSet()
    for (const field of fields) {
      set.add(field)
    }
    return set
  }
}

export class Field<T = unknown> {
  readonly name: string
  signal: Signal<T>

  constructor(name: string, signal: Signal<T>) {
    this.name = name
    this.signal = signal
  }

  static fromFacet<O>(name: string, facet: ZDSFacet<unknown, O>) {
    return new Field(name, facet.signal)
  }

  declare extension: Extension
}
