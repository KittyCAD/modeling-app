import '../../../src/index.css'
import type { Preview } from '@storybook/react-vite'
import '../../../src/index.css'

const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'paper',
      values: [
        { name: 'paper', value: '#f4efe4' },
        { name: 'charcoal', value: '#18212f' },
      ],
    },
  },
}

export default preview
