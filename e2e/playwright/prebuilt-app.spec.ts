import { expect, test } from '@playwright/test'

test.describe('Prebuilt web app', { tag: '@web' }, () => {
  test.skip(
    process.env.E2E_USE_PREBUILT_APP !== '1',
    'Requires the prebuilt web app'
  )

  test('serves built JavaScript on direct application routes', async ({
    request,
  }) => {
    for (const route of ['/', '/home', '/file/local/project/main.kcl']) {
      const response = await request.get(route)
      expect(response.ok()).toBe(true)
      const html = await response.text()
      const entry = html.match(
        /<script\b[^>]*type="module"[^>]*src="([^"]+)"/
      )?.[1]
      if (!entry) throw new Error(`No module entry point on ${route}`)
      expect(entry).toMatch(/^\/assets\/.+\.js$/)
      expect(html).not.toContain('/@vite/client')

      const script = await request.get(entry)
      expect(script.ok()).toBe(true)
      expect(script.headers()['content-type']).toContain('javascript')
    }
  })

  test('serves the Wasm binary with its streaming content type', async ({
    request,
  }) => {
    const response = await request.get('/kcl_wasm_lib_bg.wasm')
    expect(response.ok()).toBe(true)
    expect(response.headers()['content-type']).toContain('application/wasm')
    expect((await response.body()).subarray(0, 4)).toEqual(
      Buffer.from([0x00, 0x61, 0x73, 0x6d])
    )
  })
})
