import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@e2e/playwright/zoo-test'
import type {
  PalettePresentation,
  PresentationNode,
} from '@e2e/performance/palette-reduction/presentation'
import { readPaletteAppearance } from '@e2e/performance/palette-reduction/presentation'

test('capture the controlled Home palette presentation', async ({
  page,
  homePage,
  cmdBar,
}) => {
  await homePage.waitForAuthentication()
  await page.waitForFunction(() =>
    window.app.settings.actor.getSnapshot().matches('idle')
  )
  await homePage.expectIsCurrentPage()
  await homePage.projectsLoaded()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setBodyDimensions({ width: 1200, height: 800 })
  await page.evaluate(() => document.fonts.ready)
  await cmdBar.cmdBarOpenBtn.click()
  await expect(page.getByTestId('cmd-bar-search')).toBeEditable()
  await page.waitForFunction(() => {
    const wrapper = document.querySelector(
      '[data-testid="command-bar-wrapper"]'
    )
    return (
      wrapper?.firstElementChild &&
      !wrapper.firstElementChild.classList.contains('duration-100') &&
      wrapper
        .getAnimations({ subtree: true })
        .every((animation) => animation.playState !== 'running')
    )
  })
  await page.mouse.move(0, 799)
  const appearance = await page.evaluate(readPaletteAppearance)
  if (!appearance) throw new Error('Missing source palette presentation')
  const artifact = path.resolve('.vite/renderer/main_window')
  const html = await readFile(path.join(artifact, 'index.html'), 'utf8')
  const stylesheetPaths = [
    ...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g),
  ].map(([tag]) => /href="([^"]+)"/.exec(tag)?.[1])
  async function digest(relativePath: string | undefined) {
    if (!relativePath) throw new Error('Missing source stylesheet path')
    return {
      path: relativePath,
      sha256: createHash('sha256')
        .update(await readFile(path.join(artifact, relativePath)))
        .digest('hex'),
    }
  }
  const fontPaths = (
    await readdir(path.join(artifact, 'fonts'), { recursive: true })
  )
    .filter((name) => /\.(woff2?|ttf|otf)$/.test(name))
    .sort()
  const assets = {
    stylesheets: await Promise.all(stylesheetPaths.map(digest)),
    fonts: await Promise.all(fontPaths.map((name) => digest(`fonts/${name}`))),
  }
  const nodes = await page.evaluate(() => {
    const allowedTags = new Set([
      'div',
      'span',
      'p',
      'input',
      'button',
      'ul',
      'li',
      'kbd',
      'svg',
      'path',
      'g',
      'circle',
      'rect',
      'line',
      'polyline',
      'polygon',
      'ellipse',
    ])
    const allowedAttributes = new Set([
      'class',
      'role',
      'type',
      'placeholder',
      'disabled',
      'popover',
      'inert',
      'data-testid',
      'data-interaction-id',
      'data-expect-interaction-ms',
      'aria-disabled',
      'aria-selected',
      'aria-label',
      'viewBox',
      'fill',
      'fill-rule',
      'clip-rule',
      'd',
      'stroke',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
      'cx',
      'cy',
      'r',
      'rx',
      'ry',
      'x',
      'y',
      'x1',
      'x2',
      'y1',
      'y2',
      'width',
      'height',
      'points',
      'transform',
    ])
    function serialize(element: Element): PresentationNode {
      const tag = element.tagName.toLowerCase()
      if (!allowedTags.has(tag))
        throw new Error(`Unexpected palette tag: ${tag}`)
      const attributes: Record<string, string> = {}
      for (const attribute of element.attributes) {
        if (allowedAttributes.has(attribute.name)) {
          attributes[attribute.name] = attribute.value
        }
      }
      const children: (PresentationNode | string)[] = []
      if (
        element instanceof HTMLElement &&
        element.style.getPropertyValue('--_delay')
      ) {
        attributes.style = `--_delay:${element.style.getPropertyValue('--_delay')}`
      }
      for (const child of element.childNodes) {
        if (child instanceof Element) children.push(serialize(child))
        else if (child.nodeType === Node.TEXT_NODE && child.textContent) {
          children.push(child.textContent)
        }
      }
      return { tag, attributes, children }
    }
    function required(testId: string) {
      const element = document.querySelector(`[data-testid="${testId}"]`)
      if (!element) throw new Error(`Missing presentation element: ${testId}`)
      return element
    }
    const launcher = required('command-bar-open-button')
    const wrapper = required('command-bar-wrapper')
    const panel = required('command-bar')
    return {
      sourceBuildRun: null,
      sourceCommit: null,
      provenance:
        'Captured from the available local optimized build; its source commit is unverified. Checked-out palette presentation sources and lockfile have no diff versus d5328e2c1e. Build byte hashes are recorded separately.',
      bodyClass: document.body.className,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      launcher: serialize(launcher),
      wrapper: { ...serialize(wrapper), children: [] },
      panel: serialize(panel),
    }
  })
  const presentation: PalettePresentation = { ...nodes, ...appearance, assets }
  await page
    .getByTestId('command-bar')
    .screenshot({ path: '/tmp/palette-source-panel.png' })
  await writeFile(
    path.join(__dirname, 'home-presentation.json'),
    `${JSON.stringify(presentation, null, 2)}\n`
  )
})
