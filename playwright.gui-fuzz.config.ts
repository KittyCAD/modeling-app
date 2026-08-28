import path from 'node:path'
import { defineConfig } from '@playwright/test'
import baseConfig from '@root/playwright.config'

const runOutputDir =
  process.env.PLAYWRIGHT_GUI_FUZZ_OUTPUT_DIR ??
  path.join('test-results', 'gui-fuzz')
const captureVideo = process.env.PLAYWRIGHT_GUI_FUZZ_VIDEO === '1'

export default defineConfig({
  ...baseConfig,
  outputDir: path.join(runOutputDir, 'artifacts'),
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(runOutputDir, 'report.json') }],
    [
      'html',
      {
        open: 'never',
        outputFolder: path.join(runOutputDir, 'html'),
      },
    ],
  ],
  use: {
    ...baseConfig.use,
    screenshot: 'on',
    trace: 'on',
    video: captureVideo
      ? { mode: 'on', size: { width: 1400, height: 900 } }
      : 'off',
  },
})
