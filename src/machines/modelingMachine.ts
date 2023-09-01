import { Program } from 'lang/abstractSyntaxTreeTypes'
import { ProgramMemory } from 'lang/executor'
import { Selections } from 'useStore'
import { createMachine } from 'xstate'

export const modelingMachine = createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAdNhJmAMQCiuALmAE4AEsA1mNQMYAWA2gAwC6iUAAdUsbNWypcQkAA9EAdgAsBAJzKArIoAcytQGYAbDp0HlAGhABPRAFoAjAZ0FlOo7x0AmXg+VflB0UDAF8QqzQMHHwiEnIAZSwwdmoGUTxqPkEkEFFxSWlZBQQ7L2MCUzUHP1NfRTUdK1sEA0VeV15eRR9lXi9NVocjMIj0LDxCYlIyRNIUhkgYLNk8iSkZHOLS8srqtx06hqbEZSNVNV5NIwvTeqG1EZBI8ZiphKT5gDMAQ3YwZZyqwKG1AWzKRgqOiqNQOQQaXmOCCuqi8KmcsIMhkUmkez2ikzilAAjgBXbDCBZyah0EkYAEiMRrQqbRBefoVa6GfzebHaRFaAwEbT+NSaUXKfS6RS4sb42LTCik8mU6m0-4ObIM-LrIqshztTS8YzmRQeI1tRSIw1eAh9br+PyGozXGVRCYEeKsDicAgASUJirJFIAMngwAwACqoVCYem5RnA3UIJwGTSuMzdHoXIYGRF2U0EMqKeoWnoGULhJ6y92ethcP2E2bJVIABVQGTjQJ1LIQxdUDjUHmzylN2MaNnsXgcBFTagCBl4DT0emcrpehFr3ob0yb81DuH+AhWCe7oKUxYIJgcy8HnjU9URbNt1TF3Q81UGa7lm-r-umyG+VgGGicNOFQOhsAAL2kahvljI9ARPZkz2TTwbRMTEHCuLCriMTREXvIUBiNNQ5wuCUjC8L8ay9et93DKMYzICBpDAIhcAAN1QVgCAAYToMBvloYCw07JCQXkRAU2nYtOlNIxryMVojDzJx2jMe9i2RMoR2UaiYh-H16MjaNMAIAA5VAGDbDJYDIABBCAIGs9saDE7VkMk5NnUUW0rjaA5UyMXQEQnEpNDTBT3F0a93B0Ac9MrPEaLrIywxMmMCBsmgGEcjAIAcpyXI7BCtSZCTimvXQhV4Z19B8XhdLzCLL0U3RLh0Q0ByufSN1otKDwyszjLyyBCuc7LMlK+MPIq1lPF8y50UdA5tEtMK7BaqLgtWzrfEMXqPX6ghjMY4b0tGgreNQABbYRSGE+j3PKpMpzFdQzD6KEfHioZEQhAYTR8TQ3CcKEHiS6sYgoKkaQwYkgxVOHD01GaXp7JchWC0UVDFYxgitfwZ0NRQgn6LotCoyG3Wh2G1QR5UwDpukNWPWak2CtNThUAdgm6eL1uaEGbVTCnWiqLoBkOmHVQwbd3jmVIfj+Z7Ex7TrfPqWERUCTQsP+zQXCNJbUWLSi9Gl5m2N3YEGAAJUEiBrBmNgGAgbBYFg3AVemrtPMqsp1M5LpF32qoDaNhcBlN00vAt6n13lcgABE4A+VJ0jc33xKTOx0VcOrSNqw3uiNREgl8vXsQWt7GvLQ63jIVPYHThZoBRtn0ZQvOdF8qETDcNkDA-dxERUAggiNfU8JL7wHAbwlm9b5WO8Q9mex7wVzElQdTko4fcw2qcOmvLwdq1+cF53Vu4Pg1G-bmkpwUhCXJd7mL-uCoUAsogJSaGK+Kc06KwYLfVWp4vJ526EKfUVxPBdFNOWVST4vAaAaOWeKAQ9YQ1GDTAkCoaD0CYP1bgrM15dy8tA42FNBwaCGGYPMUJCy9C0vFLQOFpQJ2-P1BguArIrxdiAle4D-YnA8M+XovdqhBH1COPMBgbSk0CKaKophnR4WGFwiYZBeLfG9lgERj87CBCFPFPQgQPADArnmM+fdrjLjcMRdBh1DI6L0X8O+nc1YoX1IuAgxYzAKTPqHEGNjry2laMXCKAQiwuP6sxVi7EuI8X4oJYSLBUqGKTM4XyC59DXiwnHYKKhy5+ELAETotVwbXg0HE1KJ10pnTIPQOg4ECD3SEp8cCN0+ICSEuGECWSexOCfMYZ05ZcZa3whtIYqgTBVCUnHBwbJtB1O9M0ugrS6DtMwJ07pvS0nhgyd6IZKEcnqBUOKOcSk9ChWaEpCoB8hhBGHgESxazfyL2Ac2NIrkpr3xzj2YpkIDhlGcI1K445miOGcIWXQzoai1WCl0D5Po-xAJbiAwZ2d14oRMC4PwpwSbPP0IfaF15BTaHLJKXQqZWgVkrHwjA8AcjJXwF4iBWxlDlD3voC4eFe4+DJfYCU7ROim1FIU-omjcGJzeBy0RT81AT0MJ0Q0mg46tClI+DQhZgoJTcJcNkiVZXcNSgqx+lFlWmFBRgiFJh5EapgUMbo0JKKnFRfLC1SZ9RPhdYuPCA5aq+DzAWecU4tDuEXL3E1VY8FHXqadUy3rhnEXUFYkGVRtB7FUhcW0hhh6XH3m0ABWiDLHSTZlSyxUaAsrKt4ryWFqqimHpmptOawoAzjn0BckSxQDhwXGxOhkGmDTOgQZOrEU0oSLO0VoZ9UH1WxEgsKaZu0+FROWZZLD55lr6omxppksp-Nyk5SA07G3BGnP0PWvQIpQjcP9IU664HXjcAozhpqUpbkredQal0L2VVURPAIbhTjcqNFoJ9GqDjcomY41Ze6CAy2RoBxAlFfLc0CPeedAt+QgwqGKMUEozELMtrLNi6K0O9jaIWZZg5ea9E8MKhAGj-F6HoyYauppyPIw9OndY9tHbNHrZyqSlw0wtr6JLCmZQDYQl0IEVBXGSYyqHXKFDaoCAO2+E7ajfhwmph8M8tkBNO1XHY0pwcvdVOot4fw34YBqPSvUAfAIZgBirXkYo7qUIkWB1TDiMIIQgA */
  id: 'Modeling',

  tsTypes: {} as import('./modelingMachine.typegen').Typegen0,

  context: {
    guiMode: 'default',
    selection: [] as string[],
    ast: null as Program | null,
    selectionRanges: {
      otherSelections: [],
      codeBasedSelections: [],
    } as Selections,
    programMemory: { root: {}, pendingMemory: {} } as ProgramMemory,
  },

  states: {
    idle: {
      on: {
        'Deselect point': {
          target: 'idle',
          internal: true,
          actions: 'Remove from selection',
          cond: 'Selection contains point',
        },

        'Deselect edge': {
          target: 'idle',
          internal: true,
          actions: 'Remove from selection',
          cond: 'Selection contains edge',
        },

        'Select point': {
          target: 'idle',
          internal: true,
          actions: 'Add to selection',
        },

        'Select edge': {
          target: 'idle',
          internal: true,
          actions: 'Add to selection',
        },

        'Select face': {
          target: 'idle',
          internal: true,
          actions: 'Add to selection',
        },

        'Enter sketch': [
          {
            target: 'Sketch',
            cond: 'Selection is one face',
          },
          'Sketch no face',
        ],

        'Equip extrude': [
          {
            target: 'Extrude',
            cond: 'Selection is empty',
          },
          {
            target: 'Extrude',
            cond: 'Selection is one face',
          },
        ],

        'Deselect face': {
          target: 'idle',
          internal: true,
          actions: 'Remove from selection',
          cond: 'Selection contains face',
        },

        'Select all': {
          target: 'idle',
          internal: true,
          actions: 'Add to selection',
        },

        'Deselect all': {
          target: 'idle',
          internal: true,
          actions: 'Remove from selection',
          cond: 'Selection is not empty',
        },
      },
    },

    Sketch: {
      states: {
        Idle: {
          on: {
            'Equip Line Tool': 'Line Tool',

            'Select Point': {
              target: 'Idle',
              internal: true,
            },

            'Select Line': {
              target: 'Idle',
              internal: true,
            },

            'Make line horizontal': {
              target: 'Idle',
              internal: true,
              cond: 'Can make selection horizontal',
              actions: [
                'Make selected line horizontal',
                'Update code selection cursors',
              ],
            },

            'Deselect point': {
              target: 'Idle',
              internal: true,
              cond: 'Selection contains point',
            },

            'Deselect line': {
              target: 'Idle',
              internal: true,
              cond: 'Selection contains line',
            },
          },
        },

        'Line Tool': {
          states: {
            'No Points': {
              on: {
                'Add Point': 'Point Added',
              },
            },

            Done: {
              type: 'final',
            },

            'Point Added': {
              on: {
                'Add Point': 'Line Added',
              },
            },

            'Line Added': {
              on: {
                'Add Point': {
                  target: 'Line Added',
                  internal: true,
                },

                'Complete Line': 'Done',
              },
            },
          },

          initial: 'No Points',

          invoke: {
            src: 'createLine',
            id: 'Create line',
            onDone: 'Idle',
            onError: 'Idle',
          },
        },

        Extrude: {
          states: {
            Idle: {
              on: {
                'Select Face': 'Selection Ready',
              },
            },

            'Selection Ready': {
              on: {
                'Set Distance': 'Ready',
              },
            },

            Ready: {},
          },

          initial: 'Idle',

          on: {
            'Equip Extrude Tool': [
              {
                target: '.Selection Ready',
                cond: 'Selection is one face',
              },
              '.Idle',
            ],
          },
        },
      },

      initial: 'Idle',

      on: {
        Cancel: '.Idle',
      },

      invoke: {
        src: 'createSketch',
        id: 'Create sketch',
        onDone: 'idle',
        onError: 'idle',
      },
    },

    Extrude: {
      states: {
        Idle: {
          on: {
            'Select face': 'Selection Ready',
          },
        },
        'Selection Ready': {
          on: {
            'Set distance': 'Ready',
          },
        },
        Ready: {},
      },

      initial: 'Idle',

      on: {
        'Equip extrude': [
          {
            target: '.Selection Ready',
            cond: 'Selection is one face',
          },
          '.Idle',
        ],
      },
    },

    'Sketch no face': {
      on: {
        'Select face': 'Sketch',
      },
    },
  },

  initial: 'idle',

  on: {
    Cancel: '.idle',
  },
})
