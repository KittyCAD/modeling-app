import type { StorybookConfig } from '@storybook/react-vite'
import { fileURLToPath } from 'node:url'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {
      builder: {
        // Use the repository toolchain resolved by the hoisted Storybook builder.
        viteConfigPath: fileURLToPath(
          new URL('../../../vite.storybook.config.ts', import.meta.url)
        ),
      },
    },
  },
  docs: {
    autodocs: 'tag',
  },
}

export default config
