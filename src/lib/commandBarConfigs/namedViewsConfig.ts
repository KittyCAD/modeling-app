import { Command } from '../commandTypes'
export function createNamedViewsCommand() {
  const createNamedViewCommand: Command = {
    name: 'Create named view',
    displayName: `Create named view`,
    description: 'Create a named view to reload this view',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      console.log('going to create a saved view!')
    },
    args: {
      name: {
        required: true,
        inputType: 'string',
      },
    },
  }

  return { createNamedViewCommand }
}
