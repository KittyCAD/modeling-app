import type { NamedView } from '@rust/kcl-lib/bindings/NamedView'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { KclManager } from '@src/lang/KclManager'
import { addNamedViews } from '@src/lang/modifyAst/namedViews'
import { usesKclNamedViews } from '@src/lib/commandBarConfigs/namedViewsConfig'
import { migrateProjectTomlNamedViews } from '@src/lib/namedViewsMigration'
import type { SettingsActorType } from '@src/machines/settingsMachine'

vi.mock('@src/lib/commandBarConfigs/namedViewsConfig', () => ({
  usesKclNamedViews: vi.fn(async () => true),
}))

// Building the calls needs the KCL wasm module; namedViews.spec.ts covers it.
vi.mock('@src/lang/modifyAst/namedViews', () => ({
  directedCameraFromNamedView: vi.fn(() => ({})),
  addNamedViews: vi.fn(({ views }: { views: { name: string }[] }) => ({
    modifiedAst: { body: ['modified'] },
    pathToNode: [],
    names: views.map((view) => view.name),
  })),
}))

function savedView(name: string): NamedView {
  return {
    name,
    eye_offset: 100,
    fov_y: 45,
    ortho_scale_enabled: true,
    ortho_scale_factor: 1.6,
    world_coord_system: 'right_handed_up_z',
    is_ortho: true,
    pivot_position: [0, 0, 0],
    pivot_rotation: [0, 0, 0, 1],
    version: 1.0,
  }
}

let pathCounter = 0

function setup({
  views = { a: savedView('Top'), b: savedView('Close up') },
  path = `/project-${++pathCounter}/main.kcl`,
  hasParseErrors = false,
  updateReachesCode = true,
}: {
  views?: Record<string, NamedView>
  path?: string
  hasParseErrors?: boolean
  updateReachesCode?: boolean
} = {}) {
  const kclManager = {
    path,
    ast: { body: [] },
    code: '@settings(kclVersion = 3.0)\n',
    wasmInstancePromise: Promise.resolve({}),
    hasParseErrors: () => hasParseErrors,
    updateEditorWithAstAndWriteToFile: vi.fn(async () => {
      if (updateReachesCode) {
        kclManager.code += Object.values(views)
          .map((view) => `view::named("${view.name}")\n`)
          .join('')
      }
    }),
  }

  const send = vi.fn()
  const settingsActor = {
    getSnapshot: () => ({
      context: { app: { namedViews: { current: views } } },
    }),
    send,
  } as unknown as SettingsActorType

  return {
    kclManager: kclManager as unknown as KclManager,
    settingsActor,
    update: kclManager.updateEditorWithAstAndWriteToFile,
    send,
  }
}

describe('migrateProjectTomlNamedViews', () => {
  beforeEach(() => {
    vi.mocked(usesKclNamedViews).mockResolvedValue(true)
    vi.mocked(addNamedViews).mockClear()
  })

  it('writes every saved view into main.kcl and clears the setting', async () => {
    const { kclManager, settingsActor, update, send } = setup()

    await expect(
      migrateProjectTomlNamedViews({ kclManager, settingsActor })
    ).resolves.toBe(true)

    expect(vi.mocked(addNamedViews).mock.calls[0][0].views).toHaveLength(2)
    expect(update).toHaveBeenCalledWith(
      { body: ['modified'] },
      { shouldExecute: true, shouldAddToHistory: false }
    )
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'set.app.namedViews',
        data: expect.objectContaining({ level: 'project', value: {} }),
      })
    )
  })

  it('migrates a project only once per session', async () => {
    const { kclManager, settingsActor, update } = setup()

    await migrateProjectTomlNamedViews({ kclManager, settingsActor })
    await expect(
      migrateProjectTomlNamedViews({ kclManager, settingsActor })
    ).resolves.toBe(false)

    expect(update).toHaveBeenCalledTimes(1)
  })

  it('keeps the setting when the views never reach the code', async () => {
    const { kclManager, settingsActor, update, send } = setup({
      updateReachesCode: false,
    })

    await expect(
      migrateProjectTomlNamedViews({ kclManager, settingsActor })
    ).resolves.toBe(false)
    expect(update).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('leaves files older than KCL 3.0 alone', async () => {
    vi.mocked(usesKclNamedViews).mockResolvedValue(false)
    const { kclManager, settingsActor, update, send } = setup()

    await expect(
      migrateProjectTomlNamedViews({ kclManager, settingsActor })
    ).resolves.toBe(false)
    expect(update).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('only writes into main.kcl', async () => {
    const { kclManager, settingsActor, update } = setup({
      path: '/project/parts/bracket.kcl',
    })

    await expect(
      migrateProjectTomlNamedViews({ kclManager, settingsActor })
    ).resolves.toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('waits for code that parses', async () => {
    const { kclManager, settingsActor, update } = setup({
      hasParseErrors: true,
    })

    await expect(
      migrateProjectTomlNamedViews({ kclManager, settingsActor })
    ).resolves.toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('does nothing without saved views', async () => {
    const { kclManager, settingsActor, update } = setup({ views: {} })

    await expect(
      migrateProjectTomlNamedViews({ kclManager, settingsActor })
    ).resolves.toBe(false)
    expect(update).not.toHaveBeenCalled()
  })
})
