/**
 * The reactive DOM layer.
 *
 * Signals in, real DOM nodes out. There is no virtual DOM, no component
 * instance, and no render pass: a signal is wired directly to the attribute,
 * text node, or child region it controls.
 */
export {
  computed,
  effect,
  batch,
  signal,
  untracked,
  type ReadonlySignal,
  type Signal,
} from '@preact/signals-core'

export {
  type Child,
  type ClassValue,
  type Reactive,
  type StyleValue,
  appendChild,
  bind,
  dynamic,
  fragment,
  h,
  isSignal,
  mount,
  peek,
  svg,
  text,
} from './dom'

export {
  type EachOptions,
  each,
  portal,
  show,
  switchOn,
  when,
} from './control'

export {
  type Scope,
  disposeScope,
  getCurrentScope,
  onDispose,
  runInScope,
  withScope,
} from './scope'
