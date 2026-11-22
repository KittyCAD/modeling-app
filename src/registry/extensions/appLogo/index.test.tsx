import { signal } from '@preact/signals-core'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'
import { AppHeaderFrame } from '@src/components/AppHeaderFrame'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { appHeaderStartItemsFacet } from '@src/registry/contracts/appHeader'
import appHeaderExtension from '@src/registry/extensions/appHeader'
import appLogoExtension from '@src/registry/extensions/appLogo'
import { act, cleanup, render, screen } from '@testing-library/react'
import { contribute, Registry, slot } from 'plankton'
import { Link, MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

let registry: Registry
vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    registry,
    auth: { useUser: () => undefined, send: vi.fn() },
    fileOperations: testFileOperations,
  }),
}))
afterEach(async () => {
  cleanup()
  await registry.dispose()
})

it('can omit or replace the logo without removing the project and account menus', async () => {
  registry = new Registry()
  const branding = slot([])
  await registry.configure([appHeaderExtension, branding])
  const session: OpenProjectSession = {
    signal: new AbortController().signal,
    project: signal({
      contents: { name: 'Bracket', path: '/project', children: [] },
      metadata: { title: 'Bracket', readWriteAccess: false },
    }),
    files: { read: vi.fn(), write: vi.fn() },
  }
  render(
    <MemoryRouter>
      <AppHeaderFrame context={{ type: 'project', session }} />
    </MemoryRouter>
  )
  expect(
    screen.queryByRole('link', { name: 'Projects' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Bracket' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'User menu' })).toBeVisible()

  await act(async () => {
    await registry.replace(branding, [appLogoExtension])
  })
  expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute(
    'href',
    '/home'
  )

  await act(async () => {
    await registry.replace(branding, [
      contribute(appHeaderStartItemsFacet, () => ({
        id: 'customer.home',
        order: -100,
        Component: () => <Link to="/home">Customer workspace</Link>,
      })),
    ])
  })
  expect(
    screen.queryByRole('link', { name: 'Projects' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Customer workspace' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Bracket' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'User menu' })).toBeVisible()
})
