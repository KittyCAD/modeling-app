const plugin = require('tailwindcss/plugin')

const themeColorRamps = [
  { name: 'chalkboard', stops: 12 },
  { name: 'energy', stops: 12 },
  { name: 'liquid', stops: 12 },
  { name: 'fern', stops: 12 },
  { name: 'cool', stops: 12 },
  { name: 'river', stops: 12 },
  { name: 'berry', stops: 12 },
  { name: 'destroy', stops: 8 },
  { name: 'warn', stops: 8 },
  { name: 'succeed', stops: 8 },
]
const toOKLCHVar = (val) => `oklch(var(${val}) / <alpha-value>) `

const themeColors = Object.fromEntries(
  themeColorRamps.map(({ name, stops }) => [
    name,
    Object.fromEntries(
      new Array(stops)
        .fill(0)
        .map((_, i) => [(i + 1) * 10, toOKLCHVar(`--_${name}-${(i + 1) * 10}`)])
    ),
  ])
)

// Keep role families separate: background level 2 is not foreground level 2.
const roleColors = (family, levels) =>
  Object.fromEntries([
    ['default', toOKLCHVar(`--_${family}-default`)],
    ['1', toOKLCHVar(`--_${family}-default`)],
    ...levels.map((level) => [level, toOKLCHVar(`--_${family}-${level}`)]),
  ])
const surfaces = roleColors('surface', [2, 3, 4, 5, 6])
const foregrounds = roleColors('foreground', [2, 3, 4, 5, 6])
const borders = roleColors('border', [2, 3, 4, 5])
const colorValue = (value, opacityValue = 1) =>
  typeof value === 'function' ? value({ opacityValue }) : value

/** @type {import('tailwindcss').Config} */
module.exports = {
  mode: 'jit',
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './packages/ui-components/src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: `oklch(var(--_primary) / <alpha-value>)`,
        'ml-green': '#29FFA4',
        'ml-black': 'var(--chalkboard-100)',
        'ml-white': '#FFFFFF',
        'ml-grey': 'var(--chalkboard-80)',
        ...themeColors,
      },
      backgroundColor: surfaces,
      textColor: foregrounds,
      borderColor: { bg: surfaces },
      fontFamily: {
        sans: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
        'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
        sans-serif`,
      },
      /**
       * We want the z-index of major UI areas
       * to be consolidated in this one spot,
       * so we can make sure they coordinate.
       */
      zIndex: {
        // TODO change use of `z-<number>` to use these instead
        // underlay: '-1',
        // tooltip: '1',
        // commandBar: '2',
        // modal: '3',
        sketchSegmentIndicators: '5',
        sketchOverlayDropdown: '6',
        // top: '99',
      },
    },
  },
  darkMode: 'class',
  plugins: [
    plugin(({ matchUtilities }) => {
      matchUtilities(
        {
          b: (value) => ({
            borderColor: colorValue(value, 'var(--tw-border-opacity, 1)'),
          }),
        },
        { values: borders, type: 'color' }
      )
      matchUtilities(
        { 'outline-color': (value) => ({ outlineColor: colorValue(value) }) },
        { values: borders, type: 'color' }
      )
    }),
    require('@headlessui/tailwindcss'),
    // custom plugin to add variants for aria-pressed
    // To use, just add a class of 'group-pressed:<some-tailwind-class>' or 'pressed:<some-tailwind-class>'
    // to your element. Based on https://dev.to/philw_/tying-tailwind-styling-to-aria-attributes-502f
    plugin(function ({ addVariant, e }) {
      addVariant('group-pressed', ({ modifySelectors, separator }) => {
        modifySelectors(({ className }) => {
          return `.group[aria-pressed='true'] .${e(
            `group-pressed${separator}${className}`
          )}`
        })
      })
      addVariant('pressed', ({ modifySelectors, separator }) => {
        modifySelectors(({ className }) => {
          return `.${e(`pressed${separator}${className}`)}[aria-pressed='true']`
        })
      })
      addVariant('light', 'body:not(.dark) &')
    }),
  ],
}
