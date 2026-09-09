import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { isArray } from '@src/lib/utils'
import path from 'node:path'
import { build } from 'vite'

async function promptPosition(page: Page) {
  const transcript = await page.getByTestId('transcript').boundingBox()
  const prompt = await page.getByTestId('prompt').last().boundingBox()
  if (!transcript || !prompt) throw new Error('Missing conversation layout')
  return (prompt.y - transcript.y) / transcript.height
}

async function expectAnchored(page: Page) {
  await expect.poll(() => promptPosition(page)).toBeCloseTo(0.2, 2)
}

async function sampleSubmitTransition(
  page: Page,
  options: { stream?: boolean; interrupt?: boolean } = {}
) {
  return page.evaluate(async ({ stream, interrupt }) => {
    const transcript = document.querySelector('[data-testid="transcript"]')
    const buttons = [...document.querySelectorAll('button')]
    const submit = buttons.find((button) => button.textContent === 'Submit')
    const reason = buttons.find((button) => button.textContent === 'Reason')
    const complete = buttons.find((button) => button.textContent === 'Complete')
    if (!transcript || !submit || !reason || !complete) {
      throw new Error('Missing scroll fixture controls')
    }
    submit.click()
    const startedAt = performance.now()
    const samples: { elapsed: number; position: number }[] = []
    let interruptedPosition: number | undefined
    return new Promise<{
      samples: typeof samples
      interruptedPosition?: number
    }>((resolve) => {
      const sample = (now: number) => {
        const prompts = transcript.querySelectorAll('[data-testid="prompt"]')
        const prompt = prompts.item(prompts.length - 1)
        const bounds = transcript.getBoundingClientRect()
        const position =
          (prompt.getBoundingClientRect().top - bounds.top) / bounds.height
        const elapsed = now - startedAt
        samples.push({ elapsed, position })
        if (interrupt && elapsed >= 80 && interruptedPosition === undefined) {
          interruptedPosition = position
          transcript.dispatchEvent(
            new WheelEvent('wheel', { deltaY: -100, bubbles: true })
          )
        }
        // Keep changing the response during and after the expected transition.
        if (stream && elapsed < 450) {
          ;(samples.length % 2 ? reason : complete).click()
        }
        if (elapsed < 600) {
          requestAnimationFrame(sample)
        } else {
          resolve({ samples, interruptedPosition })
        }
      }
      requestAnimationFrame(sample)
    })
  }, options)
}

test.describe('Zookeeper conversation scrolling', { tag: '@web' }, () => {
  let fixtureCode: string

  test.beforeAll(async () => {
    // Bundle locally so these layout tests also work when the app under test
    // is a deployed preview, which does not serve the e2e source directory.
    const bundle = await build({
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      resolve: { alias: { '@src': path.resolve('src') } },
      build: {
        write: false,
        minify: false,
        lib: {
          entry: path.resolve('e2e/playwright/fixtures/zookeeperScroll.tsx'),
          formats: ['iife'],
          name: 'ZookeeperScrollFixture',
        },
      },
    })
    const output = isArray(bundle) ? bundle[0] : bundle
    if (!output || !('output' in output))
      throw new Error('Missing scroll fixture bundle')
    const script = output.output.find((item) => item.type === 'chunk')
    if (!script) throw new Error('Missing scroll fixture script')
    fixtureCode = script.code
  })

  test.beforeEach(async ({ page }) => {
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: fixtureCode })
  })

  test('slides the submitted prompt into place without restarting for streamed updates', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Load history' }).click()
    const { samples } = await sampleSubmitTransition(page, { stream: true })
    expect(samples[0].position).toBeGreaterThan(0.25)
    expect(
      samples.filter(
        (sample) =>
          sample.position > 0.22 && sample.position < samples[0].position
      )
    ).not.toHaveLength(0)
    for (const sample of samples.filter((sample) => sample.elapsed > 400)) {
      expect(sample.position).toBeCloseTo(0.2, 2)
    }
    await expectAnchored(page)
  })

  test('cancels the submit transition when the reader scrolls', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Load history' }).click()
    const { samples, interruptedPosition } = await sampleSubmitTransition(
      page,
      { stream: true, interrupt: true }
    )
    expect(interruptedPosition).toBeGreaterThan(0.25)
    for (const sample of samples.slice(-5)) {
      expect(sample.position).toBeCloseTo(interruptedPosition ?? 0, 2)
    }
  })

  test('positions immediately when reduced motion is requested', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Load history' }).click()
    const { samples } = await sampleSubmitTransition(page)
    for (const sample of samples) {
      expect(sample.position).toBeCloseTo(0.2, 2)
    }
  })

  test('anchors new prompts and keeps room through reasoning, completion, resize, and errors', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expectAnchored(page)
    await page.getByRole('button', { name: 'Reason', exact: true }).click()
    await expectAnchored(page)
    await page.getByRole('button', { name: 'Complete', exact: true }).click()
    await expectAnchored(page)
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect(page.getByTestId('spacer')).toHaveCSS('height', '0px')
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expectAnchored(page)
    await page.getByRole('button', { name: 'Resize', exact: true }).click()
    await expectAnchored(page)
    await page.getByRole('button', { name: 'Error', exact: true }).click()
    await expectAnchored(page)
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expectAnchored(page)
  })

  test('follows overflow until the reader scrolls away, and resumes at the bottom or on submit', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Load history' }).click()
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expectAnchored(page)
    await page.getByRole('button', { name: 'Grow', exact: true }).click()
    const transcript = page.getByTestId('transcript')
    const bottomDistance = () =>
      transcript.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight
      )
    await expect.poll(bottomDistance).toBeLessThan(4)

    await transcript.hover({ position: { x: 350, y: 300 } })
    await page.mouse.wheel(0, -250)
    await expect.poll(bottomDistance).toBeGreaterThan(100)
    const readingPosition = await transcript.evaluate((el) => el.scrollTop)
    await page.getByRole('button', { name: 'Grow', exact: true }).click()
    await expect
      .poll(() => transcript.evaluate((el) => el.scrollTop))
      .toBe(readingPosition)

    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect
      .poll(() => transcript.evaluate((el) => el.scrollTop))
      .toBe(readingPosition)

    await transcript.hover({ position: { x: 350, y: 300 } })
    await page.mouse.wheel(0, 5000)
    await expect.poll(bottomDistance).toBeLessThan(4)
    await page.getByRole('button', { name: 'Grow', exact: true }).click()
    await expect.poll(bottomDistance).toBeLessThan(4)
    await transcript.hover({ position: { x: 350, y: 300 } })
    await page.mouse.wheel(0, -250)
    await expect.poll(bottomDistance).toBeGreaterThan(100)
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expectAnchored(page)
  })

  test('keeps nested reasoning scrolling independent and loads history without a new-turn spacer', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await page.getByRole('button', { name: 'Reason', exact: true }).click()
    await page.getByTestId('reasoning').hover()
    await page.mouse.wheel(0, 150)
    await expect
      .poll(() => page.getByTestId('reasoning').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Grow', exact: true }).click()
    await expect
      .poll(() =>
        page
          .getByTestId('transcript')
          .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
      )
      .toBeLessThan(4)

    await page.getByRole('button', { name: 'Load history' }).click()
    await expect(page.getByTestId('spacer')).toHaveCSS('height', '0px')
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect(page.getByTestId('spacer')).toHaveCSS('height', '0px')
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expectAnchored(page)
  })

  test('honors upward scroll intent before the browser delivers a scroll event', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Load history' }).click()
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await page.getByRole('button', { name: 'Grow', exact: true }).click()
    const transcript = page.getByTestId('transcript')
    const readingPosition = await transcript.evaluate((el) => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
      return el.scrollTop
    })
    await page.getByRole('button', { name: 'Grow', exact: true }).click()
    await expect
      .poll(() => transcript.evaluate((el) => el.scrollTop))
      .toBe(readingPosition)
  })
})
