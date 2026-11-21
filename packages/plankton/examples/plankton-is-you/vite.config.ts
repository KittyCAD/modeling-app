import { defineConfig } from 'vite'

export default defineConfig({
  // The linked package and this sample must share one reactive runtime.
  // Do not discover the parent application's PostCSS/Tailwind configuration.
  css: { postcss: { plugins: [] } },
  resolve: { dedupe: ['@preact/signals-core', 'react', 'react-dom'] },
})
