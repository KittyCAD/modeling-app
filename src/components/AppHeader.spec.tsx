import { AppHeader } from '@src/components/AppHeader'
import { App } from '@src/lib/app'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { createProjectForTest } from '@src/lib/projectTestUtils'
import { createTestWasmRegistryItem, loadWasm } from '@src/unitTestUtils'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

let app: App
vi.mock('@src/lib/boot', () => ({
  useApp: () => app,
  useSingletons: () => app.singletons,
}))
let wasm: ReturnType<typeof loadWasm>
beforeAll(async () => {
  wasm = loadWasm()
  await wasm
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
afterEach(async () => {
  cleanup()
  await app?.disposeAsync()
})

it('opens the legacy header with the installed services and navigates Home without a document load', async () => {
  app = App.fromProvided({
    registryOverrides: [createTestWasmRegistryItem(wasm)],
  })
  await vi.waitFor(() =>
    expect(app.settings.actor.getSnapshot().matches('idle')).toBe(true)
  )
  await app.registryReady
  const path = `/tmp/header-regression-${crypto.randomUUID()}`
  await fsZds.mkdir(path, { recursive: true })
  await fsZds.writeFile(
    fsZds.join(path, 'main.kcl'),
    new TextEncoder().encode('// header regression\n')
  )
  try {
    await app.openProject(
      createProjectForTest(path, {
        default_file: fsZds.join(path, 'main.kcl'),
        children: [
          {
            name: 'main.kcl',
            path: fsZds.join(path, 'main.kcl'),
            children: null,
          },
        ],
      })
    )
    const router = createMemoryRouter(
      [
        {
          path: '/file/:id',
          element: (
            <AppHeader
              enableMenu
              project={app.project?.projectIORefSignal.value}
              nativeFileMenuCreated={false}
            />
          ),
        },
        { path: '/home', element: <div>Project library</div> },
      ],
      { initialEntries: ['/file/project'] }
    )
    render(<RouterProvider router={router} />)
    expect(screen.getByTestId('project-sidebar-toggle')).toBeVisible()
    fireEvent.click(screen.getByTestId('project-sidebar-toggle'))
    expect(await screen.findByText('Project settings')).toBeVisible()
    fireEvent.click(screen.getByRole('link', { name: 'Projects' }))
    expect(await screen.findByText('Project library')).toBeVisible()
  } finally {
    await app.closeProject()
    await fsZds.rm(path, { recursive: true, force: true })
  }
})
