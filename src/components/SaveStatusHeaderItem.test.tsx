import { signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lib/projectSession'
import { SaveStatusHeaderItem } from '@src/components/SaveStatusHeaderItem'
import { projectSession } from '@src/registry/contracts/projectSession'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { projectSessionExtension } from '@src/registry/extensions/projectSession'
import { act, render, screen } from '@testing-library/react'
import { provide, Registry, slot } from 'plankton'
import { expect, it } from 'vitest'

it('follows a replacement session provider and hides when it is removed', async () => {
  const owner = new Registry()
  const registry = new Registry()
  const providers = slot()
  await owner.configure([
    projectSessionExtension,
    provide(fileOperationsService, testFileOperations),
  ])
  const session = owner.required(projectSession)
  session.setProject({
    path: '/project',
    executingEditor: signal(null),
  } as ZDSProject)
  const storage = session.storageFor('/project')
  const provider = (reason: string) =>
    provide(projectSession, {
      ...session,
      storageFor: () => ({
        ...storage,
        writeAvailability: signal({ writable: false as const, reason }),
      }),
    })
  await registry.configure([providers])
  const view = render(<SaveStatusHeaderItem app={{ registry }} />)
  try {
    expect(view.container).toBeEmptyDOMElement()
    await act(async () => {
      await registry.replace(providers, [provider('Offline')])
    })
    expect(screen.getByRole('status')).toHaveTextContent('Offline')
    await act(async () => {
      await registry.replace(providers, [provider('Read-only')])
    })
    expect(screen.getByRole('status')).toHaveTextContent('Read-only')
    await act(async () => {
      await registry.replace(providers, [])
    })
    expect(view.container).toBeEmptyDOMElement()
  } finally {
    view.unmount()
    await registry.dispose()
    await owner.dispose()
  }
})
