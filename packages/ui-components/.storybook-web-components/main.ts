import type { StorybookConfig } from '@storybook/web-components-vite'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const config: StorybookConfig = {
  stories: ['../src/web-components/**/*.stories.ts'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    // Resolve from this workspace even when npm installs the renderer locally.
    name: dirname(
      fileURLToPath(
        import.meta.resolve('@storybook/web-components-vite/package.json')
      )
    ),
    options: {},
  },
}

export default config
