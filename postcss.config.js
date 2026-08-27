module.exports = {
  plugins: {
    // The token set is authored in OKLCH. `preserve` keeps the original
    // declarations so browsers that support it get the wide-gamut values.
    '@csstools/postcss-oklab-function': { preserve: true },
    autoprefixer: {},
  },
}
