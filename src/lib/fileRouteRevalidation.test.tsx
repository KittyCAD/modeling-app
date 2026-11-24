import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
// eslint-disable-next-line zds/no-react-router-hooks -- Exercise React Router's real loader-data consumer in this route-policy test.
import { useLoaderData } from 'react-router-dom'
import type { FormMethod, LoaderFunctionArgs } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFileRouteRevalidation } from '@src/lib/fileRouteRevalidation'

function EditorRoute() {
  const { fileId } = useLoaderData<{ fileId: string }>()
  const [draft, setDraft] = useState('saved code')
  return (
    <>
      <h1>{fileId}</h1>
      <label>
        Editor draft
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <Outlet />
    </>
  )
}

const routers = new Set<ReturnType<typeof createMemoryRouter>>()
afterEach(() => {
  for (const router of routers) router.dispose()
  routers.clear()
})

async function openEditor(initialEntry = '/file/main.kcl') {
  const loader = vi.fn(({ params }: LoaderFunctionArgs) => ({
    fileId: params.id ?? '',
  }))
  const action = vi.fn(() => ({ saved: true }))
  const router = createMemoryRouter(
    [
      {
        id: 'file',
        path: '/file/:id',
        loader,
        shouldRevalidate: createFileRouteRevalidation('/file/:id', '/settings'),
        element: <EditorRoute />,
        children: [
          { path: 'settings', element: <h2>Settings</h2>, action },
          { path: 'onboarding', element: <h2>Onboarding</h2> },
          { path: 'telemetry', element: <h2>Telemetry</h2> },
        ],
      },
    ],
    { initialEntries: [initialEntry] }
  )
  routers.add(router)
  render(<RouterProvider router={router} />)
  const input = await screen.findByRole('textbox', { name: 'Editor draft' })
  fireEvent.change(input, { target: { value: 'unsaved code' } })
  expect(loader).toHaveBeenCalledTimes(1)
  return { router, loader, action, input }
}

describe('file route Settings revalidation', () => {
  it.each(['main.kcl', encodeURIComponent('/projects/model/main.kcl')])(
    'preserves the mounted editor and unsaved code across Settings navigation for %s',
    async (fileId) => {
      const fileUrl = `/file/${fileId}`
      const { router, loader, input } = await openEditor(fileUrl)
      for (const destination of [
        `${fileUrl}/settings?tab=user`,
        `${fileUrl}/settings?tab=project`,
        `${fileUrl}/settings?tab=keybindings#modeling.cameraProjection`,
        `${fileUrl}/settings?tab=plugins`,
        `${fileUrl}/settings#settings-about`,
        `${fileUrl}/settings`,
        fileUrl,
      ]) {
        await act(() => router.navigate(destination))
        expect(
          router.state.location.pathname +
            router.state.location.search +
            router.state.location.hash
        ).toBe(destination)
        expect(loader).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('textbox', { name: 'Editor draft' })).toBe(
          input
        )
        expect(input).toHaveValue('unsaved code')
      }
    }
  )

  it('retains unchanged non-Settings query values while tabs change', async () => {
    const { router, loader } = await openEditor(
      '/file/main.kcl?pool=existing&name=part'
    )
    await act(() =>
      router.navigate(
        '/file/main.kcl/settings?name=part&tab=user&pool=existing'
      )
    )
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it.each([
    '/file/other.kcl/settings?tab=user',
    `/file/${encodeURIComponent('/projects/other/main.kcl')}/settings?tab=user`,
  ])('loads real file/project navigation to %s', async (destination) => {
    const { router, loader } = await openEditor(
      '/file/main.kcl/settings?tab=user'
    )
    await act(() => router.navigate(destination))
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it.each([
    'project-id=shared-project',
    'create-file&name=imported.kcl&code=program',
    'cmd=Import&groupId=projects',
    'pool=different',
    'zookeeper-prompt=make+a+box',
    'unknown-intent=keep-default-behavior',
  ])('keeps default loading for changed query intent %s', async (query) => {
    const { router, loader } = await openEditor(
      '/file/main.kcl/settings?tab=user'
    )
    await act(() =>
      router.navigate(`/file/main.kcl/settings?tab=project&${query}`)
    )
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it.each(['onboarding', 'telemetry'])(
    'keeps default loading for the %s child route',
    async (child) => {
      const { router, loader } = await openEditor(
        '/file/main.kcl/settings?tab=user'
      )
      await act(() => router.navigate(`/file/main.kcl/${child}`))
      expect(loader).toHaveBeenCalledTimes(2)
    }
  )

  it('reloads explicit revalidation', async () => {
    const { router, loader } = await openEditor(
      '/file/main.kcl/settings?tab=user'
    )
    await act(() => router.revalidate())
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
  })

  it('reloads manual navigation to the same Settings URL', async () => {
    const url = '/file/main.kcl/settings?tab=user'
    const { router, loader } = await openEditor(url)
    await act(() => router.navigate(url))
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it.each(['GET', 'POST'] satisfies FormMethod[])(
    'keeps loader revalidation for a %s form submission',
    async (formMethod) => {
      const { router, loader, action } = await openEditor(
        '/file/main.kcl/settings?tab=user'
      )
      const formData = new FormData()
      formData.set('tab', 'project')
      await act(() =>
        router.navigate('/file/main.kcl/settings?tab=project', {
          formMethod,
          formData,
        })
      )
      expect(loader).toHaveBeenCalledTimes(2)
      expect(action).toHaveBeenCalledTimes(formMethod === 'POST' ? 1 : 0)
    }
  )
})
