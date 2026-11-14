import { signal } from '@preact/signals-core'
import { expect, it } from 'vitest'
import { protect } from './protection'

it('preserves private fields, getter liveness, and detached method receivers', () => {
  class Counter {
    #value = 0
    get value() {
      return this.#value
    }
    increment(amount: number) {
      this.#value += amount
      return this.#value
    }
  }
  const original = new Counter()
  const facade = protect(original, () => {})
  // The facade supplies the receiver; detaching the method exercises that guarantee.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const increment = facade.increment

  expect(facade).toBeInstanceOf(Counter)
  expect(increment(2)).toBe(2)
  expect(facade.value).toBe(2)
  original.increment(3)
  expect(facade.value).toBe(5)
  expect(Reflect.get(facade, 'increment')).toBe(increment)
})

it('guards methods even on frozen implementations without freezing the caller object', () => {
  let mutations = 0
  const failure = new Error('Combining a Facet must not invoke service methods')
  let combining = true
  const original = Object.freeze({
    increment: () => {
      mutations++
    },
  })
  const facade = protect(original, () => {
    if (combining) throw failure
  })

  expect(() => facade.increment()).toThrow(failure)
  expect(mutations).toBe(0)
  combining = false
  facade.increment()
  expect(mutations).toBe(1)
  const mutable = { value: 1 }
  protect(mutable, () => {})
  mutable.value = 2
  expect(Object.isFrozen(mutable)).toBe(false)
})

it('keeps signal views live, readonly, and stable', () => {
  const value = signal(1)
  const original = Object.freeze({ value })
  const facade = protect(original, () => {})
  const view = facade.value
  expect(view).not.toBe(value)
  expect(view.value).toBe(1)
  value.value = 2
  expect(view.value).toBe(2)
  expect(facade.value).toBe(view)
  expect(() => {
    view.value = 3
  }).toThrow()
  expect(value.value).toBe(2)
})

it('does not confuse ordinary value objects with signals', () => {
  const ordinary = { value: 1 }
  const facade = protect({ ordinary }, () => {})
  expect(facade.ordinary).toBe(ordinary)
})

it('blocks writes and reflection mutations without invoking accessors during construction', () => {
  let reads = 0
  let writes = 0
  const original = {
    field: 1,
    get value() {
      reads++
      return this.field
    },
    set value(next: number) {
      writes++
      this.field = next
    },
  }
  const facade = protect(original, () => {})
  expect(reads).toBe(0)
  expect(Object.keys(facade)).toEqual(['field', 'value'])
  expect(reads).toBe(0)
  expect(() => {
    facade.field = 2
  }).toThrow('readonly')
  expect(() => {
    facade.value = 2
  }).toThrow('readonly')
  expect(() => Reflect.defineProperty(facade, 'field', { value: 2 })).toThrow(
    'readonly'
  )
  expect(() => Reflect.deleteProperty(facade, 'field')).toThrow('readonly')
  expect(() => Object.setPrototypeOf(facade, null)).toThrow('readonly')
  expect(() => Object.preventExtensions(facade)).toThrow('readonly')
  expect(writes).toBe(0)
  expect(original.field).toBe(1)
  expect(facade.value).toBe(1)
})

it('property descriptors expose guarded methods rather than the original function', () => {
  const failure = new Error('Method use is forbidden')
  const method = () => 1
  const original = Object.freeze({ method })
  const facade = protect(original, () => {
    throw failure
  })
  const descriptor = Object.getOwnPropertyDescriptor(facade, 'method')
  if (!descriptor?.get) throw new Error('Expected a readonly accessor')
  const exposed = descriptor.get()
  expect(exposed).not.toBe(method)
  expect(() => exposed()).toThrow(failure)
})
