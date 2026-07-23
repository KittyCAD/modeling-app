import { resolve } from 'node:path'
import oklab from '@csstools/postcss-oklab-function'
import type { StorybookConfig } from '@storybook/react-vite'
import autoprefixer from 'autoprefixer'
import tailwindcss from 'tailwindcss'
import { mergeConfig } from 'vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  docs: {
    autodocs: 'tag',
  },
  typescript: {
    reactDocgen: false,
  },
  viteFinal: async (config) =>
    mergeConfig(config, {
      css: {
        postcss: {
          plugins: [
            tailwindcss({
              config: resolve(__dirname, '../../../tailwind.config.js'),
            }),
            oklab({ preserve: true }),
            autoprefixer(),
          ],
        },
      },
    }),
}

export default config
