import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import { closeOnboardingModalIfPresent } from '@e2e/playwright/test-utils'
import { expect, type Page, type TestInfo } from '@playwright/test'

export const GUI_FUZZ_VIEWPORT = { width: 1400, height: 900 }
export const GUI_FUZZ_EMPTY_CODE = '@settings(kclVersion = 2.0)\n'

export async function installGuiFuzzPointerOverlay(page: Page) {
  const installOverlay = () => {
    const installWhenReady = () => {
      if (document.documentElement.dataset.guiFuzzPointerOverlay === 'true') {
        return
      }
      document.documentElement.dataset.guiFuzzPointerOverlay = 'true'

      const pointer = document.createElement('div')
      pointer.id = 'gui-fuzz-pointer-overlay'
      Object.assign(pointer.style, {
        background: 'rgba(255, 213, 0, 0.45)',
        border: '4px solid #ff2d55',
        borderRadius: '9999px',
        boxShadow: '0 0 0 3px white, 0 2px 8px rgba(0, 0, 0, 0.55)',
        height: '26px',
        left: '0',
        pointerEvents: 'none',
        position: 'fixed',
        top: '0',
        transform: 'translate(-50%, -50%)',
        width: '26px',
        zIndex: '2147483647',
      })
      document.body.append(pointer)

      const banner = document.createElement('div')
      Object.assign(banner.style, {
        background: 'rgba(15, 15, 20, 0.92)',
        border: '3px solid #ff2d55',
        borderRadius: '8px',
        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.4)',
        color: 'white',
        font: '700 16px/1.2 sans-serif',
        left: '50%',
        opacity: '0',
        padding: '8px 12px',
        pointerEvents: 'none',
        position: 'fixed',
        top: '16px',
        transform: 'translateX(-50%)',
        transition: 'opacity 80ms linear',
        zIndex: '2147483647',
      })
      document.body.append(banner)

      let bannerTimer = 0
      let canvasClickCount = 0
      let pointerFrame = 0
      let pointerPosition = { x: 0, y: 0 }

      window.addEventListener(
        'pointermove',
        (event) => {
          pointerPosition = { x: event.clientX, y: event.clientY }
          if (pointerFrame) {
            return
          }
          pointerFrame = window.requestAnimationFrame(() => {
            pointerFrame = 0
            pointer.style.left = `${pointerPosition.x}px`
            pointer.style.top = `${pointerPosition.y}px`
          })
        },
        true
      )

      window.addEventListener(
        'pointerdown',
        (event) => {
          const stream = document.querySelector('[data-testid="stream"]')
          const streamBounds = stream?.getBoundingClientRect()
          const target = event.target instanceof Element ? event.target : null
          const targetButton = target?.closest('button')
          const isCanvasClick = Boolean(
            streamBounds &&
              !targetButton &&
              event.clientX >= streamBounds.left &&
              event.clientX <= streamBounds.right &&
              event.clientY >= streamBounds.top &&
              event.clientY <= streamBounds.bottom
          )
          const targetLabel =
            targetButton?.getAttribute('aria-label') ||
            targetButton?.textContent?.trim() ||
            target?.getAttribute('aria-label') ||
            'UI control'

          if (isCanvasClick) {
            canvasClickCount += 1
          }
          const clickNumber = isCanvasClick ? canvasClickCount : null

          window.requestAnimationFrame(() => {
            const marker = document.createElement('div')
            Object.assign(marker.style, {
              background: 'rgba(255, 45, 85, 0.18)',
              border: '5px solid #ff2d55',
              borderRadius: '9999px',
              boxShadow: '0 0 0 3px white, 0 2px 10px rgba(0, 0, 0, 0.6)',
              height: '40px',
              left: `${event.clientX}px`,
              pointerEvents: 'none',
              position: 'fixed',
              top: `${event.clientY}px`,
              transform: 'translate(-50%, -50%)',
              width: '40px',
              zIndex: '2147483646',
            })

            if (clickNumber !== null) {
              const label = document.createElement('div')
              label.textContent = `CANVAS CLICK ${clickNumber}`
              Object.assign(label.style, {
                background: '#ff2d55',
                border: '2px solid white',
                borderRadius: '4px',
                color: 'white',
                font: '700 14px/1.2 sans-serif',
                left: '46px',
                padding: '4px 6px',
                position: 'absolute',
                top: '-4px',
                whiteSpace: 'nowrap',
              })
              marker.append(label)
            } else {
              window.setTimeout(() => marker.remove(), 1_200)
            }
            document.body.append(marker)

            banner.textContent =
              clickNumber === null
                ? `CLICK: ${targetLabel.slice(0, 50)}`
                : `CANVAS CLICK ${clickNumber}`
            banner.style.opacity = '1'
            window.clearTimeout(bannerTimer)
            bannerTimer = window.setTimeout(() => {
              banner.style.opacity = '0'
            }, 1_200)
          })
        },
        true
      )
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', installWhenReady, {
        once: true,
      })
    } else {
      installWhenReady()
    }
  }

  await page.addInitScript(installOverlay)
  await page.evaluate(installOverlay)
}

type RuntimeEvent = {
  category: 'browser' | 'connection' | 'request'
  message: string
  timestamp: string
}

export function observeGuiFuzzRuntime(page: Page) {
  const events: RuntimeEvent[] = []
  const record = (category: RuntimeEvent['category'], message: string) => {
    events.push({ category, message, timestamp: new Date().toISOString() })
  }

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      record('browser', `${message.type()}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => record('browser', error.message))
  page.on('requestfailed', (request) => {
    record(
      'request',
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'unknown error'}`
    )
  })
  page.on('websocket', (socket) => {
    socket.on('close', () => record('connection', `${socket.url()}: closed`))
    socket.on('socketerror', (error) =>
      record('connection', `${socket.url()}: ${error}`)
    )
  })

  return events
}

export async function prepareGuiFuzzProject(page: Page, editor: EditorFixture) {
  await page.route('**/user/projects**', async (route) => {
    const method = route.request().method()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await route.continue()
      return
    }

    await route.abort('blockedbyclient')
  })

  await closeOnboardingModalIfPresent(page)

  const initialCode = (await editor.getCurrentCode()).replace(/\s+/g, '')
  if (initialCode && !/^@settings\([^)]*\)$/.test(initialCode)) {
    throw new Error(
      'Refusing to reset a non-empty project. GUI fuzz production runs require a fresh, browser-local Playwright project.'
    )
  }

  if (!initialCode) {
    await editor.replaceCode('', GUI_FUZZ_EMPTY_CODE)
  }
  await editor.expectEditor.toContain('@settings(')
}

export async function waitForGuiFuzzSketchReady(
  page: Page,
  editor: EditorFixture,
  toolbar: ToolbarFixture
) {
  await expect(toolbar.exitSketchBtn).toBeVisible()
  await expect(toolbar.exitSketchBtn).toBeEnabled()
  await editor.expectEditor.toContain('sketch(')

  const configuredDelay = Number(
    process.env.ZDS_GUI_FUZZ_POST_SKETCH_WAIT_MS ?? 0
  )
  if (Number.isFinite(configuredDelay) && configuredDelay > 0) {
    await page.waitForTimeout(Math.min(configuredDelay, 10_000))
  }
}

export async function setGuiFuzzIsometricView(page: Page) {
  await page.evaluate(async () => {
    await window.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: crypto.randomUUID(),
      cmd: {
        type: 'view_isometric',
        padding: 0.15,
      },
    })
  })
}

export async function captureGuiFuzzStep(
  page: Page,
  testInfo: TestInfo,
  step: number,
  name: string
) {
  const filename = `${String(step).padStart(2, '0')}-${name}.png`
  const screenshotPath = testInfo.outputPath(filename)
  await page.screenshot({
    animations: 'disabled',
    mask: [
      page.getByTestId('user-sidebar-toggle').locator('.avatar'),
      page.locator('img[alt="user avatar"]'),
    ],
    path: screenshotPath,
  })
  await testInfo.attach(filename, {
    contentType: 'image/png',
    path: screenshotPath,
  })
}

export async function attachGuiFuzzRuntimeEvents(
  testInfo: TestInfo,
  events: RuntimeEvent[]
) {
  await testInfo.attach('runtime-events.json', {
    body: JSON.stringify(events, null, 2),
    contentType: 'application/json',
  })
}
