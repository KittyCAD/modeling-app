import { KclMigrationPanel } from '@src/components/KclMigrationPanel'
import {
  migrationFixture,
  sourceCode,
  successfulOperation,
  targetCode,
} from '@src/lib/kclMigration/testHelpers'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

let fixture: Awaited<ReturnType<typeof migrationFixture>>
beforeEach(async () => {
  fixture = await migrationFixture()
})
afterEach(async () => {
  await fixture.dispose()
})

it('asks for preview consent, reviews a real response, applies only on acceptance and exposes project Undo', async () => {
  const view = render(
    <KclMigrationPanel
      controller={fixture.controller}
      chatBusy={false}
      enabled
      sourceIsKcl2
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Migrate to KCL 3' }))
  expect(
    screen.getByRole('button', { name: 'Start Free Migration' })
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Start Free Migration' }))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Converting')
  )
  await act(async () => {
    fixture.send(successfulOperation(fixture.request))
  })
  expect(
    await screen.findByRole('heading', { name: 'Review Changes' })
  ).toBeVisible()
  expect(screen.getByText('main.kcl')).toBeVisible()
  expect(
    screen.getByText('Physical properties and parameter checks passed.')
  ).toBeVisible()
  expect(await fixture.readMain()).toBe(sourceCode)
  fireEvent.click(screen.getByRole('button', { name: 'Apply Migration' }))
  expect(
    await screen.findByRole('button', { name: 'Undo Migration' })
  ).toBeVisible()
  expect(await fixture.readMain()).toBe(targetCode)
  view.rerender(
    <KclMigrationPanel
      controller={fixture.controller}
      chatBusy={false}
      enabled
      sourceIsKcl2={false}
    />
  )
  view.unmount()
  const reopened = render(
    <KclMigrationPanel
      controller={fixture.controller}
      enabled
      sourceIsKcl2={false}
      chatBusy={false}
    />
  )
  expect(screen.getByRole('button', { name: 'Undo Migration' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Undo Migration' }))
  await waitFor(async () => expect(await fixture.readMain()).toBe(sourceCode))
  reopened.rerender(
    <KclMigrationPanel
      controller={fixture.controller}
      enabled
      sourceIsKcl2
      chatBusy={false}
    />
  )
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'original project was restored'
    )
  )
  expect(await fixture.readMain()).toBe(sourceCode)
})

it('does not offer migration when the rollout flag is disabled', () => {
  render(
    <KclMigrationPanel
      controller={fixture.controller}
      chatBusy={false}
      enabled={false}
      sourceIsKcl2
    />
  )
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('does not offer migration for a project without an explicit KCL 2 entrypoint', () => {
  render(
    <KclMigrationPanel
      controller={fixture.controller}
      chatBusy={false}
      enabled
      sourceIsKcl2={false}
    />
  )
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('waits for ordinary chat before starting or applying a migration', async () => {
  const view = render(
    <KclMigrationPanel
      controller={fixture.controller}
      enabled
      sourceIsKcl2
      chatBusy
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Migrate to KCL 3' }))
  fireEvent.click(screen.getByRole('checkbox'))
  expect(
    screen.getByRole('button', { name: 'Start Free Migration' })
  ).toBeDisabled()
  view.rerender(
    <KclMigrationPanel
      controller={fixture.controller}
      enabled
      sourceIsKcl2
      chatBusy={false}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Start Free Migration' }))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Converting')
  )
  await act(async () => {
    fixture.send(successfulOperation(fixture.request))
  })
  await screen.findByRole('heading', { name: 'Review Changes' })
  view.rerender(
    <KclMigrationPanel
      controller={fixture.controller}
      enabled
      sourceIsKcl2
      chatBusy
    />
  )
  expect(screen.getByRole('button', { name: 'Apply Migration' })).toBeDisabled()
  expect(await fixture.readMain()).toBe(sourceCode)
})
