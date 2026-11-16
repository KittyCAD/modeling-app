import { createRequire } from 'node:module'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import { beforeAll, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const config = require('../tailwind.config.js')
const roles = [
  ['bg-2', 'background-color'],
  ['text-2', 'color'],
  ['b-4', 'border-color'],
  ['outline-color-4', 'outline-color'],
  ['border-bg-2', 'border-color'],
]
const opacityLevels = [0, 25, 75, 100]
let css
beforeAll(async () => {
  const classes = roles.flatMap(([role]) =>
    opacityLevels.map((opacity) => `${role}/${opacity}`)
  )
  const result = await postcss([
    tailwind({
      ...config,
      content: [{ raw: [...classes, 'border-2', 'b-4'].join(' ') }],
    }),
  ]).process('@tailwind utilities;', { from: undefined })
  css = result.root
})
function declarations(className) {
  const selector = `.${className.replaceAll('/', '\\/')}`
  let values
  css.walkRules(selector, (rule) => {
    values = Object.fromEntries(
      rule.nodes.map((node) => [node.prop, node.value])
    )
  })
  expect(values, `Expected a generated utility for ${className}`).toBeDefined()
  return values
}

it('opacity variants keep the same role color and apply the requested transparency', () => {
  for (const [role, property] of roles) {
    let color
    for (const opacity of opacityLevels) {
      const value = declarations(`${role}/${opacity}`)[property]
      const slash = value.lastIndexOf('/')
      const expression = value.slice(0, slash).trim()
      const alpha = Number(
        value
          .slice(slash + 1)
          .replace(')', '')
          .trim()
      )
      expect(alpha).toBe(opacity / 100)
      if (color) expect(expression).toBe(color)
      color = expression
    }
  }
})
it('border width stays independent of semantic border color', () => {
  expect(declarations('border-2')['border-width']).toBe('2px')
  expect(declarations('border-2')['border-color']).toBeUndefined()
  expect(declarations('b-4')['border-color']).toBeDefined()
  expect(declarations('b-4')['border-width']).toBeUndefined()
})
