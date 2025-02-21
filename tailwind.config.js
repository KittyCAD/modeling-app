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

/** @type {import('tailwindcss').Config} */
module.exports = {
  mode: 'jit',
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: `oklch(var(--_primary) / <alpha-value>)`,
        ...themeColors,
      },
      fontFamily: {
        display: `'owners', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
        'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
        sans-serif`,
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
    }),
  ],
}
