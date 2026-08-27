import { type ReadonlySignal, Signal, effect } from '@preact/signals-core'
import { onDispose, runInScope } from './scope'

/**
 * A value that may be constant, a signal, or a zero-argument getter.
 *
 * Accepting all three means callers can write `class: 'a'`,
 * `class: someSignal`, or `class: () => cond.value ? 'a' : 'b'` without
 * thinking about which the library wants.
 */
export type Reactive<T> = T | ReadonlySignal<T> | (() => T)

export type ClassValue =
  | string
  | null
  | undefined
  | false
  | Record<string, Reactive<boolean | null | undefined>>
  | ClassValue[]

export type StyleValue =
  | string
  | null
  | undefined
  | Record<string, Reactive<string | number | null | undefined>>

export type Child =
  | Node
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | ReadonlySignal<Child>
  | (() => Child)
  | Child[]

/** Narrow a value to a signal without depending on class identity across bundles. */
export function isSignal<T>(value: unknown): value is ReadonlySignal<T> {
  return (
    value instanceof Signal ||
    (typeof value === 'object' &&
      value !== null &&
      'value' in value &&
      'peek' in value &&
      typeof (value as { peek: unknown }).peek === 'function')
  )
}

function isGetter<T>(value: unknown): value is () => T {
  return typeof value === 'function'
}

/** Read a reactive value once, without subscribing. */
export function peek<T>(value: Reactive<T>): T {
  if (isSignal<T>(value)) return value.peek()
  if (isGetter<T>(value)) return value()
  return value
}

/**
 * Apply a reactive value now and on every change.
 *
 * Static values skip the effect entirely, which keeps trees that are mostly
 * static genuinely cheap.
 */
export function bind<T>(value: Reactive<T>, apply: (next: T) => void): void {
  if (isSignal<T>(value)) {
    onDispose(effect(() => apply(value.value)))
    return
  }
  if (isGetter<T>(value)) {
    onDispose(effect(() => apply(value())))
    return
  }
  apply(value)
}

function readReactive<T>(value: Reactive<T>): T {
  if (isSignal<T>(value)) return value.value
  if (isGetter<T>(value)) return value()
  return value
}

/** Collect class names, subscribing to every reactive wrapper it walks through. */
function collectClassNames(value: ClassValue, out: string[]): void {
  if (!value) return
  if (typeof value === 'string') {
    if (value) out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectClassNames(entry, out)
    return
  }
  for (const [name, enabled] of Object.entries(value)) {
    if (readReactive(enabled)) out.push(name)
  }
}

/** True when any part of a class value needs to be re-read over time. */
function hasReactiveClassPart(value: Reactive<ClassValue>): boolean {
  if (isSignal(value) || isGetter(value)) return true
  const plain = value as ClassValue
  if (!plain || typeof plain === 'string') return false
  if (Array.isArray(plain)) return plain.some(hasReactiveClassPart)
  return Object.values(plain).some(
    (entry) => isSignal(entry) || isGetter(entry)
  )
}

/**
 * Class names are recomputed as one whole string.
 *
 * Rebuilding the full list beats toggling individual names: the record form
 * (`{ active: someSignal }`) stays correct without having to remember which
 * names a previous pass contributed.
 */
function applyClass(element: Element, value: Reactive<ClassValue>): void {
  const write = () => {
    const names: string[] = []
    collectClassNames(readReactive(value), names)
    const className = names.join(' ')
    if (className) {
      element.setAttribute('class', className)
    } else {
      element.removeAttribute('class')
    }
  }

  if (hasReactiveClassPart(value)) {
    onDispose(effect(write))
    return
  }
  write()
}

function applyStyle(
  element: HTMLElement | SVGElement,
  value: Reactive<StyleValue>
): void {
  if (isSignal(value) || isGetter(value)) {
    bind(value, (next) => setStyle(element, next))
    return
  }
  setStyle(element, value, true)
}

function setStyle(
  element: HTMLElement | SVGElement,
  value: StyleValue,
  allowReactiveEntries = false
): void {
  if (value == null) {
    element.removeAttribute('style')
    return
  }
  if (typeof value === 'string') {
    element.setAttribute('style', value)
    return
  }
  for (const [property, raw] of Object.entries(value)) {
    const write = (next: string | number | null | undefined) => {
      if (next == null || next === '') {
        element.style.removeProperty(property)
      } else if (property.startsWith('--')) {
        // Custom properties must go through setProperty; the CSSStyleDeclaration
        // camelCase path silently drops them.
        element.style.setProperty(property, String(next))
      } else {
        element.style.setProperty(property, String(next))
      }
    }
    if (allowReactiveEntries) {
      bind(raw, write)
    } else {
      write(peek(raw))
    }
  }
}

const attributeOnlyProps = new Set([
  'list',
  'form',
  'type',
  'download',
  'width',
  'height',
  'role',
])

function applyProp(element: Element, name: string, value: unknown): void {
  if (name === 'class' || name === 'className') {
    applyClass(element, value as Reactive<ClassValue>)
    return
  }

  if (name === 'style') {
    applyStyle(element as HTMLElement, value as Reactive<StyleValue>)
    return
  }

  if (name === 'ref') {
    const ref = value as (el: Element) => void | (() => void)
    const cleanup = ref(element)
    if (typeof cleanup === 'function') onDispose(cleanup)
    return
  }

  // onClick / onInput / onPointerDown ... plus a `Capture` suffix for the
  // capture phase, matching the shape people already expect from JSX.
  if (
    name.length > 2 &&
    name.startsWith('on') &&
    name[2] === name[2].toUpperCase()
  ) {
    let eventName = name.slice(2)
    let capture = false
    if (eventName.endsWith('Capture')) {
      eventName = eventName.slice(0, -'Capture'.length)
      capture = true
    }
    const type = eventName.toLowerCase()
    const listener = value as EventListener
    element.addEventListener(type, listener, capture)
    onDispose(() => element.removeEventListener(type, listener, capture))
    return
  }

  const isAttribute =
    attributeOnlyProps.has(name) ||
    name.includes('-') ||
    name.startsWith('aria') ||
    name.startsWith('data')

  bind(value as Reactive<unknown>, (next) => {
    if (isAttribute || !(name in element)) {
      if (next == null || next === false) {
        element.removeAttribute(name)
      } else {
        element.setAttribute(name, next === true ? '' : String(next))
      }
      return
    }
    // Property assignment preserves types the attribute path would stringify
    // (checked, value, disabled, indeterminate, and so on).
    ;(element as unknown as Record<string, unknown>)[name] = next
  })
}

/** Append any supported child shape to a parent node. */
export function appendChild(parent: Node, child: Child): void {
  if (child == null || child === false || child === true) return

  if (child instanceof Node) {
    parent.appendChild(child)
    return
  }

  if (Array.isArray(child)) {
    for (const entry of child) appendChild(parent, entry)
    return
  }

  if (isSignal<Child>(child) || isGetter<Child>(child)) {
    parent.appendChild(dynamic(child))
    return
  }

  parent.appendChild(document.createTextNode(String(child)))
}

/**
 * A text node bound to a reactive string.
 *
 * This is the cheapest possible update path: one `nodeValue` write, no parent
 * involvement, no reconciliation.
 */
export function text(
  value: Reactive<string | number | null | undefined>
): Text {
  const node = document.createTextNode('')
  bind(value, (next) => {
    node.nodeValue = next == null ? '' : String(next)
  })
  return node
}

/**
 * A region of the DOM whose contents are recomputed when its source changes.
 *
 * The region is delimited by two comment markers so it can live among static
 * siblings and still replace exactly its own nodes. Each recomputation runs in
 * a fresh child scope, so bindings created by the previous contents are
 * disposed before the new contents are built.
 */
export function dynamic(source: Reactive<Child>): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const start = document.createComment('')
  const end = document.createComment('')
  fragment.append(start, end)

  let disposePrevious: (() => void) | null = null

  const clear = () => {
    let node = start.nextSibling
    while (node && node !== end) {
      const next = node.nextSibling
      node.parentNode?.removeChild(node)
      node = next
    }
  }

  const render = (next: Child) => {
    disposePrevious?.()
    disposePrevious = null
    clear()

    const built = runInScope(() => {
      const inner = document.createDocumentFragment()
      appendChild(inner, next)
      return inner
    })
    disposePrevious = built.dispose
    end.parentNode?.insertBefore(built.value, end)
  }

  bind(source, render)
  onDispose(() => {
    disposePrevious?.()
    disposePrevious = null
  })

  return fragment
}

type ElementProps = Record<string, unknown>

/**
 * Create a DOM element with reactive props and children.
 *
 * The return type is the real element type, so callers keep full DOM access:
 * `h('input', ...)` gives back an `HTMLInputElement`, not a wrapper.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElementProps | null,
  ...children: Child[]
): HTMLElementTagNameMap[K]
export function h(
  tag: string,
  props?: ElementProps | null,
  ...children: Child[]
): HTMLElement
export function h(
  tag: string,
  props?: ElementProps | null,
  ...children: Child[]
): HTMLElement {
  const element = document.createElement(tag)

  if (props) {
    for (const [name, value] of Object.entries(props)) {
      if (value === undefined) continue
      applyProp(element, name, value)
    }
  }

  for (const child of children) appendChild(element, child)

  return element
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Same as `h`, in the SVG namespace. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  props?: ElementProps | null,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag)

  if (props) {
    for (const [name, value] of Object.entries(props)) {
      if (value === undefined) continue
      applyProp(element, name, value)
    }
  }

  for (const child of children) appendChild(element, child)

  return element as SVGElementTagNameMap[K]
}

/** A fragment, for returning several siblings from one builder. */
export function fragment(...children: Child[]): DocumentFragment {
  const frag = document.createDocumentFragment()
  for (const child of children) appendChild(frag, child)
  return frag
}

/**
 * Attach children to a container and return a disposer.
 *
 * This is the root of an ownership tree: everything built during `mount` is
 * owned by the returned disposer.
 */
export function mount(container: Node, ...children: Child[]): () => void {
  const built = runInScope(() => {
    const frag = document.createDocumentFragment()
    for (const child of children) appendChild(frag, child)
    return frag
  })

  const nodes = Array.from(built.value.childNodes)
  container.appendChild(built.value)

  return () => {
    built.dispose()
    for (const node of nodes) node.parentNode?.removeChild(node)
  }
}
