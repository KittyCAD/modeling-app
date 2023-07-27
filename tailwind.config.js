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
const toOKLCHVar = val => `oklch(var(${val}) / <alpha-value>) `

const themeColors = Object.fromEntries(
  themeColorRamps.map(({name, stops}) => [
      name,
      Object.fromEntries(
          new Array(stops)
              .fill(0)
              .map((_, i) => [
                  (i + 1) * 10,
                  toOKLCHVar(`--_${name}-${(i + 1) * 10}`),
              ])
      ),
  ])
)

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ...themeColors,
      },
    },
  },
  darkMode: 'class',
  plugins: [],
}
