import { expect, test } from '@e2e/playwright/base-test'

test(
  'shows recovery instructions when WebGL is unavailable at startup',
  { tag: '@web' },
  async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = new Proxy(
        // eslint-disable-next-line @typescript-eslint/unbound-method -- The proxy forwards the original canvas as `this`.
        HTMLCanvasElement.prototype.getContext,
        {
          apply(target, canvas, args) {
            if (['webgl', 'webgl2', 'experimental-webgl'].includes(args[0])) {
              return null
            }
            return Reflect.apply(target, canvas, args)
          },
        }
      )
    })

    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'WebGL is unavailable' })
    ).toBeVisible()
    await expect(page.getByText(/graphics acceleration/)).toBeVisible()
    expect(errors).toEqual([])

    await page.evaluate(() => {
      localStorage.setItem('startup-recovery-test', 'preserve me')
    })
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Reload' }).click(),
    ])
    await expect(
      page.getByRole('heading', { name: 'WebGL is unavailable' })
    ).toBeVisible()
    expect(
      await page.evaluate(() => localStorage.getItem('startup-recovery-test'))
    ).toBe('preserve me')
    expect(errors).toEqual([])
  }
)

test(
  'does not mislabel unrelated startup failures as WebGL unavailability',
  { tag: '@web' },
  async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = () => {
        throw new Error('Unexpected canvas initialization failure')
      }
    })

    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Zoo Design Studio could not start' })
    ).toBeVisible()
    await expect(page.getByText(/graphics acceleration/)).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    expect(errors).toEqual([])
  }
)

test(
  'reaches sign-in when WebGL is available',
  { tag: '@web' },
  async ({ page }) => {
    // The app redirects logged-out web users to the website after mounting.
    // Keep this startup test independent of the external sign-in service.
    await page.route(
      (url) =>
        url.pathname === '/signin' && url.searchParams.has('callbackUrl'),
      (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Sign in</title>',
        })
    )
    await page.goto('/')
    await expect(page).toHaveURL(
      (url) => url.pathname === '/signin' && url.searchParams.has('callbackUrl')
    )
    await expect(page).toHaveTitle('Sign in')
  }
)
