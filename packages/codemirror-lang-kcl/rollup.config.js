import { lezer } from '@lezer/generator/rollup'
import esbuild from 'rollup-plugin-esbuild'

export default {
  input: 'src/index.ts',
  // imports are considered internal if they start with './' or '/' or 'word:'
  external: (id) => id != 'tslib' && !/^(\.?\/|\w:)/.test(id),
  output: [
    { file: 'dist/index.cjs', format: 'cjs' },
    { file: 'dist/index.js', format: 'es' },
  ],
  plugins: [lezer(), esbuild({ target: 'esnext' })],
}
