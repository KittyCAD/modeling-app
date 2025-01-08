import dts from 'rollup-plugin-dts'
import { lezer } from '@lezer/generator/rollup'
import typescript from '@rollup/plugin-typescript'

export default [
  {
    input: 'src/index.ts',
    // imports are considered internal if they start with './' or '/' or 'word:'
    external: (id) => id != 'tslib' && !/^(\.?\/|\w:)/.test(id),
    output: [
      { file: 'dist/index.cjs', format: 'cjs' },
      { file: 'dist/index.js', format: 'es' },
    ],
    plugins: [lezer(), typescript()],
  },
  {
    input: 'src/index.ts',
    external: (id) => id != 'tslib' && !/^(\.?\/|\w:)/.test(id),
    output: [
      { file: 'dist/index.d.cts', format: 'cjs' },
      { file: 'dist/index.d.ts', format: 'es' },
    ],
    plugins: [lezer(), typescript(), dts()],
  },
]
