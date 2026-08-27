import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { Split } from './split'

const panes = [
  { id: 'left', content: <div>left</div>, minSize: 100 },
  { id: 'right', content: <div>right</div>, minSize: 100 },
]

let host: HTMLDivElement | null = null

/**
 * Render and flush effects.
 *
 * Preact defers `useEffect`, so without `act` the layout effect has not run yet
 * and the component looks like it never published anything.
 */
function mount(node: preact.ComponentChild) {
  host = document.createElement('div')
  document.body.appendChild(host)
  act(() => {
    render(node, host as HTMLDivElement)
  })
  return host
}

function rerender(node: preact.ComponentChild, target: HTMLElement) {
  act(() => {
    render(node, target)
  })
}

/** The template the component published, whichever axis CSS applies it to. */
const template = (element: HTMLElement) =>
  element
    .querySelector<HTMLElement>('.zds-split')
    ?.style.getPropertyValue('--zds-split-template') ?? ''

afterEach(() => {
  if (host) render(null, host)
  host = null
})

describe('Split', () => {
  it('renders one pane per entry with a gutter between', () => {
    const element = mount(
      <Split orientation="inline" panes={panes} sizes={signal([0.5, 0.5])} />
    )

    expect(element.querySelectorAll('.zds-split__pane')).toHaveLength(2)
    expect(element.querySelectorAll('.zds-split__gutter')).toHaveLength(1)
  })

  it('drives pane extents from the sizes signal', () => {
    const sizes = signal([0.25, 0.75])
    const element = mount(
      <Split orientation="inline" panes={panes} sizes={sizes} />
    )

    expect(template(element)).toContain('0.25fr')
    expect(template(element)).toContain('0.75fr')
  })

  it('follows the signal without re-rendering', () => {
    const sizes = signal([0.5, 0.5])
    const element = mount(
      <Split orientation="inline" panes={panes} sizes={sizes} />
    )

    act(() => {
      sizes.value = [0.2, 0.8]
    })
    expect(template(element)).toContain('0.2fr')
  })

  it('follows a replaced sizes signal', () => {
    // Regression: the layout effect used to be created once on mount, so a
    // caller that swapped in a different sizes signal — which is exactly what
    // resetting a layout does — kept getting the extents of the signal the
    // component first saw.
    const first = signal([0.5, 0.5])
    const element = mount(
      <Split orientation="inline" panes={panes} sizes={first} />
    )
    expect(template(element)).toContain('0.5fr')

    const second = signal([0.9, 0.1])
    rerender(
      <Split orientation="inline" panes={panes} sizes={second} />,
      element
    )
    expect(template(element)).toContain('0.9fr')

    // The old signal must no longer drive anything.
    act(() => {
      first.value = [0.1, 0.9]
    })
    expect(template(element)).toContain('0.9fr')
  })

  it('normalises sizes that do not sum to one', () => {
    const element = mount(
      <Split orientation="inline" panes={panes} sizes={signal([2, 2])} />
    )
    expect(template(element)).toContain('0.5fr')
  })

  it('falls back to an even split when the size count does not match', () => {
    const element = mount(
      <Split orientation="inline" panes={panes} sizes={signal([1, 1, 1])} />
    )
    expect(template(element)).toContain('0.5fr')
  })

  it('lays out rows rather than columns when stacked', () => {
    const element = mount(
      <Split orientation="block" panes={panes} sizes={signal([0.3, 0.7])} />
    )
    const split = element.querySelector<HTMLElement>('.zds-split')

    expect(template(element)).toContain('0.3fr')
    // Which axis the template drives is a CSS decision, keyed off this class.
    expect(split?.classList.contains('zds-split--block')).toBe(true)
  })

  it('exposes each gutter as a labelled separator', () => {
    const element = mount(
      <Split orientation="inline" panes={panes} sizes={signal([0.5, 0.5])} />
    )
    const gutter = element.querySelector('.zds-split__gutter')

    expect(gutter?.getAttribute('role')).toBe('separator')
    expect(gutter?.getAttribute('aria-orientation')).toBe('vertical')
    expect(gutter?.getAttribute('aria-label')).toContain('left')
    expect(gutter?.getAttribute('tabindex')).toBe('0')
  })
})
