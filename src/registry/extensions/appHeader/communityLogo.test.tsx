import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    registry,
    auth: { useUser: () => undefined, send: vi.fn() },
    fileOperations: testFileOperations,
  }),
}))
import { cleanup, render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Registry } from 'plankton'
import source from '@root/examples/community-plugins/personal-logo.zds.ts?raw'
import { compilePlugin } from '@src/lib/communityPlugins/source'
import { createCommunityPluginsExtension } from '@src/lib/communityPlugins/registry'
import { communityPluginsService } from '@src/lib/communityPlugins/registry/contract'
import { pluginStorageFixture } from '@src/lib/communityPlugins/testSupport'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { requireSuccess } from '@src/lib/editors/testViews'
import { AppHeaderFrame } from '@src/components/AppHeaderFrame'
import appHeaderExtension from '@src/registry/extensions/appHeader'
import { parseLogoLink } from '@src/registry/extensions/appHeader/communityLogo'

let registry: Registry | undefined
const definition = {
  id: 'home',
  label: 'My workshop - Home',
  text: 'My workshop',
  logo: { viewBox: [0, 0, 24, 24], paths: ['M4 3H20V7H8V11H18V15H8V21H4Z'] },
}
afterEach(async () => {
  cleanup()
  await registry?.dispose()
  registry = undefined
})

it.each([
  { ...definition, href: 'https://example.test' },
  { ...definition, Component: { callback: 0 } },
  {
    ...definition,
    logo: { ...definition.logo, src: 'https://example.test/logo.svg' },
  },
  {
    ...definition,
    logo: { ...definition.logo, paths: ['<svg onload="alert(1)">'] },
  },
  { ...definition, logo: { ...definition.logo, paths: [{ callback: 0 }] } },
  { ...definition, logo: { ...definition.logo, viewBox: [0, 0, 0, 24] } },
  {
    ...definition,
    logo: { ...definition.logo, viewBox: [0, 0, Infinity, 24] },
  },
  {
    ...definition,
    logo: {
      ...definition.logo,
      paths: Array.from({ length: 17 }, () => 'M0 0Z'),
    },
  },
])('rejects unsupported logo content: %j', (value) => {
  expect(parseLogoLink(value)).toBeInstanceOf(Error)
})

const open = async (fixture: ReturnType<typeof pluginStorageFixture>) => {
  registry = new Registry()
  await registry.configure([
    appHeaderExtension,
    createCommunityPluginsExtension(fixture.storage),
  ])
  const manager = registry.required(communityPluginsService)
  await manager.settled()
  return manager
}
const renderHeader = () =>
  render(
    <MemoryRouter>
      <AppHeaderFrame context={{ type: 'home' }} />
    </MemoryRouter>
  )

it('installs the authored logo without data permissions, restores it after restart, and withdraws it on disable or uninstall', async () => {
  const fixture = pluginStorageFixture()
  const manager = await open(fixture)
  requireSuccess(
    await manager.install(
      requireSuccess(await compilePlugin(source)),
      'snapshot',
      undefined,
      new Set()
    )
  )
  const id = manager.entries.value[0].installation.id
  renderHeader()
  expect(
    screen.getByRole('link', { name: 'My workshop - Home' })
  ).toHaveAttribute('href', '/home')
  expect(screen.getByText('My workshop')).toBeVisible()
  expect(screen.getByRole('button', { name: 'User menu' })).toBeVisible()
  expect(
    screen.queryByRole('link', { name: 'Projects' })
  ).not.toBeInTheDocument()
  await act(async () => {
    requireSuccess(await manager.setEnabled(id, false))
  })
  expect(
    screen.queryByRole('link', { name: 'My workshop - Home' })
  ).not.toBeInTheDocument()
  await act(async () => {
    requireSuccess(await manager.setEnabled(id, true))
  })
  expect(screen.getByRole('link', { name: 'My workshop - Home' })).toBeVisible()
  cleanup()
  await registry!.dispose()
  const restored = await open(fixture)
  renderHeader()
  expect(screen.getByRole('link', { name: 'My workshop - Home' })).toBeVisible()
  await act(async () => {
    requireSuccess(await restored.uninstall(id))
  })
  expect(
    screen.queryByRole('link', { name: 'My workshop - Home' })
  ).not.toBeInTheDocument()
})

it('preserves the working logo when an edited source requests unsupported markup', async () => {
  const manager = await open(pluginStorageFixture())
  requireSuccess(
    await manager.install(
      requireSuccess(await compilePlugin(source)),
      'development',
      '/personal-logo.zds.ts',
      new Set()
    )
  )
  renderHeader()
  const edited = source.replace(
    "text: 'My workshop',",
    "text: 'Broken replacement', href: 'https://example.test',"
  )
  const owner = Symbol('logo editor')
  await act(async () => {
    manager.updateDevelopment(
      '/personal-logo.zds.ts',
      requireSuccess(await compilePlugin(edited)),
      owner
    )
    await manager.settled()
  })
  expect(screen.getByText('My workshop')).toBeVisible()
  expect(screen.queryByText('Broken replacement')).not.toBeInTheDocument()
  await act(async () => {
    manager.updateDevelopment(
      '/personal-logo.zds.ts',
      requireSuccess(
        await compilePlugin(
          source.replace("text: 'My workshop',", "text: 'Edited workshop',")
        )
      ),
      owner
    )
    await manager.settled()
  })
  expect(screen.getByText('Edited workshop')).toBeVisible()
})
