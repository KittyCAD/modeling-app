import type { NamedView } from '@rust/kcl-lib/bindings/NamedView'
import {
  addNamedViews,
  declaredViewNames,
  directedCameraFromNamedView,
} from '@src/lang/modifyAst/namedViews'
import { assertParse, recast } from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type RustContext from '@src/lib/rustContext'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance, engineCommandManager, rustContext } =
    await buildTheWorldAndNoEngineConnection()
  instanceInThisFile = instance
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})
afterAll(() => {
  engineCommandManagerInThisFile.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

const settings = `@settings(kclVersion = "3.0-preview")`

/** The app's default three-quarter camera, as `project.toml` saved it. */
const defaultCamera: NamedView = {
  name: 'Saved',
  eye_offset: 20.907703,
  fov_y: 45,
  ortho_scale_enabled: true,
  ortho_scale_factor: 1.6,
  world_coord_system: 'right_handed_up_z',
  is_ortho: false,
  pivot_position: [0, 0, 0],
  pivot_rotation: [0.4247082, 0.1759199, 0.33985114, 0.8204732],
  version: 1.0,
}

describe('namedViews.spec.ts', () => {
  describe('Testing addNamedViews', () => {
    it('should append a view::named call for a saved camera', async () => {
      const ast = assertParse(`${settings}\nwidth = 10\n`, instanceInThisFile)
      const result = addNamedViews({
        ast,
        views: [
          {
            name: 'Overview',
            camera: directedCameraFromNamedView(defaultCamera),
          },
        ],
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain('width = 10')
      expect(newCode).toContain(`view::named(
  "Overview",
  camera = view::directed(
    [-0.5774, 0.5774, -0.5774],
    up = [-0.4082, 0.4082, 0.8165],
    target = [0mm, 0mm, 0mm],
    distance = 20.9077mm,
    projection = view::Projection::Perspective,
  ),
  baseline = view::Visibility::Show,
)`)
      expect(result.names).toEqual(['Overview'])
    })

    it('should keep millimeters in a file whose default unit is inches', async () => {
      const ast = assertParse(
        `@settings(kclVersion = "3.0-preview", defaultLengthUnit = in)\n`,
        instanceInThisFile
      )
      const result = addNamedViews({
        ast,
        views: [
          {
            name: 'Close up',
            camera: directedCameraFromNamedView({
              ...defaultCamera,
              pivot_position: [1.5, -2, 0],
              eye_offset: 123.45678,
              is_ortho: true,
            }),
          },
        ],
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain('target = [1.5mm, -2mm, 0mm]')
      expect(newCode).toContain('distance = 123.4568mm')
      expect(newCode).toContain('projection = view::Projection::Orthographic')
    })

    it('should rename views whose names the program already uses', async () => {
      const ast = assertParse(
        `${settings}
existing = view::named(
  "Front",
  camera = view::oriented(view::Orientation::Front),
  baseline = view::Visibility::Show,
)
`,
        instanceInThisFile
      )
      const camera = directedCameraFromNamedView(defaultCamera)
      const result = addNamedViews({
        ast,
        views: [
          { name: 'Front', camera },
          { name: 'Front', camera },
          { name: 'Default View', camera },
          { name: ' "Quoted" ', camera },
          { name: '', camera },
        ],
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      expect(result.names).toEqual([
        'Front (2)',
        'Front (3)',
        'Default View (2)',
        "'Quoted'",
        'View 5',
      ])
      // Every name is one view::named() accepts, so the program still runs.
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should leave the original AST untouched', () => {
      const ast = assertParse(`${settings}\nwidth = 10\n`, instanceInThisFile)
      const codeBefore = recast(ast, instanceInThisFile)
      const result = addNamedViews({
        ast,
        views: [
          { name: 'A', camera: directedCameraFromNamedView(defaultCamera) },
        ],
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      expect(recast(ast, instanceInThisFile)).toBe(codeBefore)
    })

    it('should refuse an empty list', () => {
      const ast = assertParse(settings, instanceInThisFile)
      expect(
        err(addNamedViews({ ast, views: [], wasmInstance: instanceInThisFile }))
      ).toBe(true)
    })
  })

  describe('Testing declaredViewNames', () => {
    it('should find literal view names, bound or not', () => {
      const ast = assertParse(
        `${settings}
a = view::named("Front", camera = view::oriented(view::Orientation::Front), baseline = view::Visibility::Show)
view::named('Top', camera = view::oriented(view::Orientation::Top), baseline = view::Visibility::Show)
`,
        instanceInThisFile
      )
      expect(declaredViewNames(ast)).toEqual(new Set(['Front', 'Top']))
    })
  })
})
