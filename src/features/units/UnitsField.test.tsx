import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import { AppProvider } from '@src/app/context'
import { kclSceneService } from '@src/contracts/kclScene'
import { projectSessionService } from '@src/contracts/projectSession'
import { unitsService } from '@src/contracts/units'
import { UnitsField } from '@src/features/units/UnitsField'

let host: HTMLDivElement | null = null

afterEach(() => {
  if (host) render(null, host)
  host?.remove()
  host = null
})

/** A program whose `@settings` declares a unit, or one that declares nothing. */
const programWith = (unit: string | null) => ({
  ast: {
    body: [],
    innerAttrs: unit
      ? [
          {
            name: { name: 'settings' },
            properties: [
              {
                key: { name: 'defaultLengthUnit' },
                value: { type: 'Name', name: { name: unit } },
              },
            ],
          },
        ]
      : [],
  },
})

const setup = (
  options: {
    declared?: string | null
    projectUnit?: UnitLength
    executing?: boolean
    rewritten?: string
  } = {}
) => {
  const dispatch = vi.fn()
  const buffer = {
    text: signal('width = 2'),
    dispatch,
  }

  const withLengthUnit = vi.fn(
    async () =>
      options.rewritten ?? '@settings(defaultLengthUnit = in)\nwidth = 2'
  )

  const registry = new Registry()
  registry.configure([
    defineRegistryItem({
      providesServices: [
        provideService(projectSessionService, {
          current: computed(() => ({
            executingBuffer: computed(() =>
              options.executing === false ? null : buffer
            ),
          })),
        } as never),
        provideService(kclSceneService, {
          program: computed(() =>
            options.declared === undefined
              ? programWith(null)
              : programWith(options.declared)
          ),
        } as never),
        provideService(unitsService, {
          defaultLengthUnit: computed(() => options.projectUnit ?? 'mm'),
          newFileContents: async () => '',
          withLengthUnit,
        } as never),
      ],
    }),
  ])

  host = document.createElement('div')
  document.body.appendChild(host)
  act(() =>
    render(
      <AppProvider value={{ registry, dispose: () => {} }}>
        <UnitsField />
      </AppProvider>,
      host as HTMLDivElement
    )
  )

  return { element: host as HTMLDivElement, dispatch, withLengthUnit }
}

const open = (element: HTMLDivElement) => {
  act(() => {
    element.querySelector('button')?.click()
  })
}

const items = (element: HTMLDivElement) =>
  Array.from(element.querySelectorAll('.zds-menu__item'))

describe('the units status field', () => {
  it('shows what the file declares', () => {
    const app = setup({ declared: 'in' })

    expect(app.element.textContent).toContain('in')
  })

  /*
   * The *effective* unit, which is the number a `10` in the file means — not
   * "none". A file that declares nothing is measured in the project's unit.
   */
  it('shows the project’s unit when the file declares none', () => {
    const app = setup({ declared: null, projectUnit: 'cm' })

    expect(app.element.textContent).toContain('cm')
  })

  it('says which of the two it is showing', () => {
    const declared = setup({ declared: 'ft' })
    expect(declared.element.querySelector('button')?.title).toContain(
      'declares Feet'
    )

    if (host) render(null, host)
    const inherited = setup({ declared: null, projectUnit: 'm' })
    expect(inherited.element.querySelector('button')?.title).toContain(
      'no unit'
    )
  })

  it('offers every unit, marking the one in force', () => {
    const app = setup({ declared: 'in' })

    open(app.element)

    const rows = items(app.element)
    expect(rows).toHaveLength(6)
    // Marked rather than disabled: being told which is current is the reason
    // the list is open.
    const current = rows.find((row) => row.textContent?.includes('Inches'))
    expect(current?.querySelector('svg')).not.toBeNull()
  })

  it('rewrites the file when a unit is chosen', async () => {
    const app = setup({ declared: null })
    open(app.element)

    const inches = items(app.element).find((row) =>
      row.textContent?.includes('Inches')
    )
    await act(async () => {
      ;(inches as HTMLElement).click()
    })

    expect(app.withLengthUnit).toHaveBeenCalledWith('width = 2', 'in')
    // One edit, marked as the app's rather than as typing, and no explicit
    // execution request: a text change already runs the file.
    expect(app.dispatch).toHaveBeenCalledTimes(1)
    expect(app.dispatch.mock.calls[0]?.[0]?.changes).toBeDefined()
  })

  it('writes nothing when the annotation would not change', async () => {
    const app = setup({ declared: null, rewritten: 'width = 2' })
    open(app.element)

    await act(async () => {
      ;(
        items(app.element).find((row) =>
          row.textContent?.includes('Inches')
        ) as HTMLElement
      ).click()
    })

    // kcl-lib recast the file to exactly what it already was, so there is
    // nothing to undo and nothing to run.
    expect(app.dispatch).not.toHaveBeenCalled()
  })

  it('is disabled when nothing is executing', () => {
    const app = setup({ executing: false })

    expect(app.element.querySelector('button')?.disabled).toBe(true)
  })
})
