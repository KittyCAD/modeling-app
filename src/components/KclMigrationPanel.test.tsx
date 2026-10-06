import { useSignals } from '@preact/signals-react/runtime'
import {
  KclMigrationPanel,
  KclMigrationStart,
} from '@src/components/KclMigrationPanel'
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

function MigrationView({ chatBusy = false }: { chatBusy?: boolean }) {
  useSignals()
  return fixture.controller.phase.value === 'idle' ? (
    <KclMigrationStart
      disabled={chatBusy}
      onStart={() => {
        void fixture.controller.start()
      }}
    />
  ) : (
    <KclMigrationPanel controller={fixture.controller} />
  )
}

it('starts migration, automatically applies a validated result and retains the response', async () => {
  const view = render(<MigrationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Migrate to KCL 3' }))
  expect(
    screen.getByRole('button', { name: 'Start Free Migration' })
  ).toBeEnabled()
  expect(screen.queryByRole('checkbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Start Free Migration' }))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Converting')
  )
  await act(async () => {
    fixture.send(successfulOperation(fixture.request))
  })
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Migrated to KCL 3')
  )
  expect(await fixture.readMain()).toBe(targetCode)
  expect(screen.queryByRole('button', { name: 'Apply Migration' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Review Changes' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Undo Migration' })).toBeNull()
  expect(
    screen.queryByText('Free project conversion', { exact: false })
  ).toBeNull()
  view.unmount()
  render(<MigrationView />)
  expect(screen.getByRole('status')).toHaveTextContent('Migrated to KCL 3')
})

it('waits for ordinary chat before starting a migration', () => {
  render(<MigrationView chatBusy />)
  fireEvent.click(screen.getByRole('button', { name: 'Migrate to KCL 3' }))
  expect(
    screen.getByRole('button', { name: 'Start Free Migration' })
  ).toBeDisabled()
})

it('shows live Zookeeper reasoning before migration finishes', async () => {
  await fixture.controller.start()
  await waitFor(() => expect(fixture.controller.phase.value).toBe('running'))
  render(<MigrationView />)
  await act(async () => {
    fixture.sendMessage({
      type: 'progress',
      operation_id: fixture.request.request_id,
      message: {
        reasoning: {
          type: 'markdown',
          content: 'Comparing **matching camera views**.',
        },
      },
    })
    await waitFor(() =>
      expect(fixture.controller.progress.value).toHaveLength(1)
    )
  })
  expect(screen.getByText('matching camera views')).toBeInTheDocument()
  expect(screen.getByText('See reasoning')).toBeVisible()
  expect(await fixture.readMain()).toBe(sourceCode)
})
