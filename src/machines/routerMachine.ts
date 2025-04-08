import { useLocation, useNavigate, useNavigation } from 'react-router-dom'
import { assign, setup } from 'xstate'

export const routerMachine = setup({
  types: {} as {
    context: {
      location: ReturnType<typeof useLocation>
      navigation: ReturnType<typeof useNavigation>
      navigate: ReturnType<typeof useNavigate>
    }
    input: {
      location: ReturnType<typeof useLocation>
      navigation: ReturnType<typeof useNavigation>
      navigate: ReturnType<typeof useNavigate>
    }
    events:
      | {
          type: 'event:navigate'
          data: Parameters<ReturnType<typeof useNavigate>>
        }
      | { type: 'event:set_location'; data: ReturnType<typeof useLocation> }
      | { type: 'event:set_navigation'; data: ReturnType<typeof useNavigation> }
  },
  actions: {
    navigate: (
      _,
      params: {
        navigate: ReturnType<typeof useNavigate>
        args: Parameters<ReturnType<typeof useNavigate>>
      }
    ) => {
      console.log("FRANK let's try and navigate", {
        params,
      })
      params.navigate(...params.args)
    },
  },
}).createMachine({
  id: 'router',
  context: ({ input }) => ({
    ...input,
  }),
  on: {
    'event:navigate': {
      actions: {
        type: 'navigate',
        params: ({ event, context }) => ({
          navigate: context.navigate,
          args: event.data,
        }),
      },
    },
    'event:set_location': {
      actions: assign({
        location: ({ event }) => event.data,
      }),
    },
    'event:set_navigation': {
      actions: assign({
        navigation: ({ event }) => event.data,
      }),
    },
  },
  // states: {
  //   idle: {
  //     on: {
  //       'event:navigate:start': {
  //         target: 'navigating',
  //         actions: ['navigate'],
  //       },
  //     },
  //   },
  //   navigating: {
  //     on: {
  //       'event:navigate:end': {
  //         target: 'idle',
  //       },
  //     },
  //   },
  // },
})
