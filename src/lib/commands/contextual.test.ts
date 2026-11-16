import { signal } from '@preact/signals-core'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { createContextualCommands } from '@src/lib/commands/contextual'

it('keeps the most recently activated live view through focus and disposal sequences', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          action: fc.constantFrom('activate', 'deactivate', 'dispose', 'clear'),
          view: fc.integer({ min: 0, max: 2 }),
        })
      ),
      (operations) => {
        const service = createContextualCommands()
        const sources = Array.from({ length: 3 }, () => ({
          commands: signal([]),
          scopes: signal([]),
        }))
        const handles = sources.map((source) => service.register(source))
        const retired = new Set<number>()
        let active: number | undefined
        for (const { action, view } of operations) {
          if (action === 'activate') {
            handles[view].activate()
            if (!retired.has(view)) active = view
          } else if (action === 'deactivate') {
            handles[view].deactivate()
            if (active === view) active = undefined
          } else if (action === 'dispose') {
            handles[view].dispose()
            retired.add(view)
            if (active === view) active = undefined
          } else {
            service.clear()
            active = undefined
          }
          expect(service.active.peek()).toBe(
            active === undefined ? undefined : sources[active]
          )
        }
        service.dispose()
        for (const handle of handles) handle.activate()
        expect(service.active.peek()).toBeUndefined()
      }
    )
  )
})
