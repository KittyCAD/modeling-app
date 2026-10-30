import type { ApiFile } from '@rust/kcl-lib/bindings/FrontendApi'
import { assertParse } from '@src/lang/wasm'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { describe, expect, it } from 'vitest'

const modelCode = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
radiusValue = 10mm
height = 5mm
profile = sketch(on = XY) {
  perimeter = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([perimeter.center, ORIGIN])
  radius(perimeter) == radiusValue
  horizontal([perimeter.center, perimeter.start])
}
body = extrude(region(segments = [profile.perimeter]), length = height)
`

// Real operation callbacks place each file change during native execution,
// without replacing the Wasm transport or inserting a timing delay.
describe('RustContext default plane publication', () => {
  it.each(['add', 'update'])(
    'keeps initial default planes when an unrelated file changes during execution: %s',
    async (mutation) => {
      const world = await buildTheWorldAndConnectToEngine({
        webrtc: false,
        geometryOnly: true,
      })
      const { rustContext, engineCommandManager, instance } = world
      try {
        const main: ApiFile = {
          id: 0,
          path: '/plane-publication/main.kcl',
          text: modelCode,
        }
        const other: ApiFile = {
          id: 1,
          path: '/plane-publication/unrelated.kcl',
          text: 'unrelatedValue = 1\n',
        }
        await rustContext.sendOpenProject(main.path, [main, other])
        expect(rustContext.defaultPlanes).toBeNull()

        let change: Promise<void> | undefined
        const outcome = await rustContext.execute(
          assertParse(modelCode, instance),
          {},
          main.path,
          {
            onOperation() {
              if (change) return
              change =
                mutation === 'add'
                  ? rustContext.sendAddFile({
                      id: 2,
                      path: '/plane-publication/added.kcl',
                      text: 'addedValue = 2\n',
                    })
                  : rustContext.sendUpdateFile(other.id, 'unrelatedValue = 2\n')
            },
          }
        )
        expect(change).toBeDefined()
        await change
        expect(outcome.variables.body?.type).toBe('Solid')
        expect(outcome.defaultPlanes).not.toBeNull()
        expect(rustContext.defaultPlanes).toEqual(outcome.defaultPlanes)
      } finally {
        engineCommandManager.tearDown({
          route: 'user-requested',
          initiatedBy: 'client',
        })
        world.kclManager.close()
        rustContext.destroy()
        world.commandBarActor.stop()
        world.settingsActor.stop()
      }
    },
    30_000
  )
})
