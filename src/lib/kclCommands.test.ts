import { updateModelingState } from '@src/lang/modelingWorkflows'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { kclCommands } from '@src/lib/kclCommands'
import { expect, it, vi } from 'vitest'

vi.mock('@src/lang/modelingWorkflows', () => ({
  updateModelingState: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

it('imports geometry relative to the nested KCL file', async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  const projectPath = fsZds.join(fsZds.sep, 'project')
  const command = kclCommands({
    getProject: () => ({ path: projectPath }),
    kclManager: {
      path: fsZds.join(projectPath, 'models', 'main.kcl'),
      fileSettings: {},
      ast: {
        type: 'Program',
        body: [],
        start: 0,
        end: 0,
        moduleId: 0,
        commentStart: 0,
      },
    },
  } as unknown as Parameters<typeof kclCommands>[0]).find(
    ({ name }) => name === 'Import'
  )
  if (!command) throw new Error('Missing Import command')

  command.onSubmit({ path: 'models/parts/cube.step', localName: 'cube' })

  expect(vi.mocked(updateModelingState).mock.calls[0]?.[0].body).toMatchObject([
    { type: 'ImportStatement', path: { filename: 'parts/cube.step' } },
  ])
})
