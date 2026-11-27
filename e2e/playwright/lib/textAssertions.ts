import type { Locator } from '@playwright/test'
import { expect } from '@playwright/test'
import { isArray } from '@src/lib/utils'

export async function expectRenderedDiagnosticText(
  diagnostic: Locator,
  text: string,
  options?: { timeout?: number }
) {
  await expect(diagnostic).toBeVisible(options)
  await expect
    .poll(
      async () =>
        (await diagnostic.innerText())
          .replace(/\r\n?/g, '\n')
          .replace(/\n{2,}/g, '\n\n')
          .trim(),
      options
    )
    .toBe(text)
}

/** A string version of a RegExp to get a number that may include a decimal point */
export const NUMBER_REGEXP = '((-)?\\d+(\\.\\d+)?)'

type TemplateOptions = Array<number | Array<number>>

type makeTemplateReturn = {
  regExp: RegExp
  genNext: (
    templateParts: TemplateStringsArray,
    ...options: TemplateOptions
  ) => makeTemplateReturn
}

export const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}

const _makeTemplate = (
  templateParts: TemplateStringsArray,
  ...options: TemplateOptions
) => {
  const length = Math.max(...options.map((a) => (isArray(a) ? a[0] : 0)))
  let reExpTemplate = ''
  for (let i = 0; i < length; i++) {
    const currentStr = templateParts.map((str, index) => {
      const currentOptions = options[index]
      return (
        escapeRegExp(str) +
        String(
          isArray(currentOptions)
            ? currentOptions[i]
            : typeof currentOptions === 'number'
              ? currentOptions
              : ''
        )
      )
    })
    reExpTemplate += '|' + currentStr.join('')
  }
  return new RegExp(reExpTemplate)
}

/**
 * Tool for making templates to match code snippets in the editor with some fudge factor,
 * as there's some level of non-determinism.
 *
 * Usage is as such:
 * ```typescript
 * const result = makeTemplate`const myVar = aFunc(${[1, 2, 3]})`
 * await expect(page.locator('.cm-content')).toHaveText(result.regExp)
 * ```
 * Where the value `1`, `2` or `3` are all valid and should make the test pass.
 *
 * The function also has a `genNext` function that allows you to chain multiple templates
 * together without having to repeat previous parts of the template.
 * ```typescript
 * const result2 = result.genNext`const myVar2 = aFunc(${[4, 5, 6]})`
 * ```
 */
export const makeTemplate: (
  templateParts: TemplateStringsArray,
  ...values: TemplateOptions
) => makeTemplateReturn = (templateParts, ...options) => {
  return {
    regExp: _makeTemplate(templateParts, ...options),
    genNext: (
      nextTemplateParts: TemplateStringsArray,
      ...nextOptions: TemplateOptions
    ) =>
      makeTemplate(
        [...templateParts, ...nextTemplateParts] as any as TemplateStringsArray,
        [...options, ...nextOptions] as any
      ),
  }
}

export async function isOutOfViewInScrollContainer(
  element: Locator,
  container: Locator
): Promise<boolean> {
  const elementBox = await element.boundingBox({ timeout: 5_000 })
  const containerBox = await container.boundingBox({ timeout: 5_000 })

  let isOutOfView = false
  if (elementBox && containerBox)
    return (
      elementBox.y + elementBox.height > containerBox.y + containerBox.height ||
      elementBox.y < containerBox.y ||
      elementBox.x + elementBox.width > containerBox.x + containerBox.width ||
      elementBox.x < containerBox.x
    )

  return isOutOfView
}

export function sansWhitespace(str: string) {
  return str.replace(/\s+/g, '').trim()
}
