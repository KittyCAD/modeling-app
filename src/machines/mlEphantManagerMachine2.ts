import type {
  MlCopilotClientMessage_type,
  MlCopilotServerMessage_type,
} from '@kittycad/lib/dist/types/src/models'
import { assertEvent, assign, setup, fromPromise } from 'xstate'
import type { ActorRefFrom } from 'xstate'

import { S, transitions } from '@src/machines/utils'
import { err } from '@src/lib/trap'
import { getKclVersion } from '@src/lib/kclVersion'

import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/lib/selections'
import type { FileEntry, Project } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'

import { constructMultiFileIterationRequestWithPromptHelpers } from '@src/lib/promptToEdit'

import toast from 'react-hot-toast'

export enum MlEphantManagerStates2 {
  Setup,
  Ready,
  Response,
  Request,
}

export enum MlEphantManagerTransitions2 {
  PromptEditModel = 'prompt-edit-model',
  PromptCreateModel = 'prompt-create-model',
  ContextNew = 'context-new',
  ResponseReceive = 'response-receive',
}

export type MlEphantManagerEvents2 =
  | {
      type: MlEphantManagerTransitions.PromptCreateModel
      projectForPromptOutput: Project
      prompt: string
    }
  | {
      type: MlEphantManagerTransitions.PromptEditModel
      projectForPromptOutput: Project
      prompt: string
      applicationProjectDirectory: string
      fileSelectedDuringPrompting: { entry: FileEntry; content: string }
      projectFiles: FileMeta[]
      selections: Selections
      artifactGraph: ArtifactGraph
    }
  | {
      type: MlEphantManagerTransitions.ContextNew
    }
  | {
      type: MlEphantManagerTransitions.ResponseReceive
      response: MlCopilotServerMessage_type
    }

// Used to specify a specific event in input properties
type XSEvent<T> = Extract<MlEphantManagerEvents2, { type: T }>

const onDoneErrorGoAwaitAndAssignOrToast = {
  onDone: { target: S.Await, actions: [assign(({ event }) => event.output)] },
  onError: { target: S.Await, actions: ['toastError'] },
}

const invokeTransition = <T extends MlEphantManagerTransitions2>(src: T) => ({
  invoke: {
    input: (args) => ({
      event: args.event as XSEvent<T>,
      context: args.context,
    }),
    src,
    ...onDoneErrorGoAwaitAndAssignOrToast,
  },
})

interface Exchange {
  // Technically the WebSocket could send us a response at any time, without
  // ever having requested anything - such as on WebSocket 'open'.
  request?: MlCopilotClientMessage_type

  // A response may not necessarily ever come back! (Thus list remains empty.)
  // It's possible a request triggers multiple responses, such as reasoning,
  // deltas, tool_outputs.
  // The end of a response is signaled by 'end_of_stream'.
  response: MlCopilotServerMessage_type[]
}

type Conversation = Exchange[]

export interface MlEphantManagerContext2 {
  ws: WebSocket
  conversation: {
    exchanges: Conversation
    pageToken?: string
  }
}

export const mlEphantDefaultContext2 = (input: { ws: WebSocket }) => ({
  ws: input.ws,
  conversation: {
    exchanges: [],
    pageToken: undefined,
  },
})

function assertsString(x: unknown): asserts x is string {
  if (typeof x !== 'string') {
    throw new Error('Expected payload to be of type string')
  }
}

function assertsMlCopilotServerMessage(
  x: unknown
): asserts x is MlCopilotServerMessage_type {
  if (
    'body' in response &&
    ('error' in response.body) ^
      ('info' in response.body) ^
      ('conversation_id' in response.body) ^
      ('delta' in response.body) ^
      ('tool_output' in response.body) ^
      ('reasoning' in response.body) ^
      ('end_of_stream' in response.body)
  ) {
    throw new Error('response not a MlCopilotServerMessage_type')
  }
}

export const mlEphantManagerMachine2 = setup({
  types: {
    context: {} as MlEphantManagerContext2,
    events: {} as MlEphantManagerEvents2,
  },
  actions: {
    toastError: ({ event }) => {
      console.error(event)
      if ('output' in event && event.output instanceof Error) {
        toast.error(event.output.message)
      } else if ('data' in event && event.data instanceof Error) {
        toast.error(event.data.message)
      } else if ('error' in event && event.error instanceof Error) {
        toast.error(event.error.message)
      }
    },
  },
  actors: {
    [MlEphantManagerTransitions2.Setup]: fromPromise(async function (args: {
      input: {
        event: XSEvent<MlEphantManagerTransitions2.Setup>
        context: MlEphantManagerContext2
      }
    }): Promise<Partial<MlEphantManagerContext2>> {
      ws.addEventListener('message', function (event: MessageEvent) {
        assertsString(event.data)

        let response: unknown
        try {
          response = JSON.parse(event.data)
        } catch (e: unknown) {
          throw e
        }

        assertsMlCopilotServerMessage(response)
        self.send({
          type: {
            [MlEphantManagerTransitions2.Ready]: {
              [MlEphantManagerTransitions2.Response]:
                MlEphantManagerTransitions2.ResponseReceive,
            },
          },
          response,
        })
      })

      return {
        conversation: {
          exchanges: [],
          pageToken: undefined,
        },
      }
    }),
    [MlEphantManagerTransitions2.ContextNew]: fromPromise(
      async function (args: {
        input: {
          event: XSEvent<MlEphantManagerTransitions2.ContextNew>
          context: MlEphantManagerContext2
        }
      }): Promise<Partial<MlEphantManagerContext2>> {
        ws.send(
          JSON.stringify({
            body: {
              system: {
                command: 'new',
              },
            },
          })
        )

        return {
          conversation: {
            exchanges: [],
            pageToken: undefined,
          },
        }
      }
    ),
    [MlEphantManagerTransitions2.PromptCreateModel]: fromPromise(
      async function (args: {
        input: {
          event: XSEvent<MlEphantManagerTransitions2.PromptCreateModel>
          context: MlEphantManagerContext2
        }
      }): Promise<Partial<MlEphantManagerContext2>> {
        // ws.send(JSON.stringify({
        // })

        console.log('prompt create model')
        return {}
      }
    ),
    [MlEphantManagerTransitions2.PromptEditModel]: fromPromise(
      async function (args: {
        input: {
          event: XSEvent<MlEphantManagerTransitions2.PromptEditModel>
          context: MlEphantManagerContext2
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        // const requestData = constructMultiFileIterationRequestWithPromptHelpers(
        //   {
        //     conversationId: context.conversationId,
        //     prompt: event.prompt,
        //     selections: event.selections,
        //     applicationProjectDirectory: event.applicationProjectDirectory,
        //     projectFiles: event.projectFiles,
        //     artifactGraph: event.artifactGraph,
        //     projectName: event.projectForPromptOutput.name,
        //     currentFile: event.fileSelectedDuringPrompting,
        //     kclVersion: getKclVersion(),
        //   }
        // )

        console.log('prompt edit model')
        return {}
      }
    ),
  },
}).createMachine({
  inital: MlEphantManagerStates2.Setup,
  context: mlEphantDefaultContext2,
  states: {
    [MlEphantManagerStates2.Setup]: {
      invoke: {
        input: (args) => ({
          event:
            // Setup the Websocket 'message' event listener
            args.event as XSEvent<MlEphantManagerStates2.Setup>,
          context: args.context,
        }),
        src: MlEphantManagerStates2.Setup,
        onDone: {
          target: MlEphantManagerStates2.Ready,
        },
        onError: {
          actions: ['toastError'],
        },
      },
    },
    [MlEphantManagerStates2.Ready]: {
      type: 'parallel',
      states: {
        [MlEphantManagerStates2.Response]: {
          initial: S.Await,
          states: {
            [S.Await]: {
              on: transitions([MlEphantManagerTransitions2.ResponseReceive]),
            },
            // Triggered by the WebSocket 'message' event.
            [MlEphantManagerTransitions2.ResponseReceive]: {
              target: S.Await,
              actions: [
                assign(({ event, context }) => {
                  const conversation = {
                    exchanges: Array.from(context.conversation.exchanges),
                    pageToken: context.conversation.pageToken,
                  }

                  let lastExchange: [Exchange] | [] =
                    conversation.exchanges.slice(-1)
                  if (lastExchange[0] === undefined) {
                    lastExchange.push({
                      response: [event.response],
                    })
                  } else {
                    lastExchange[0].response.push(event.response)
                  }

                  return {
                    conversation,
                  }
                }),
              ],
            },
          },
        },
        [MlEphantManagerStates2.Request]: {
          initial: S.Await,
          states: {
            [S.Await]: {
              on: transitions([
                MlEphantManagerTransitions2.PromptCreateModel,
                MlEphantManagerTransitions2.PromptEditModel,
                MlEphantManagerTransitions2.ContextNew,
              ]),
            },
            [MlEphantManagerTransitions2.ContextNew]: {
              ...invokeTransition(MlEphantManagerTransitions2.ContextNew),
            },
            [MlEphantManagerTransitions2.PromptCreateModel]: {
              ...invokeTransition(
                MlEphantManagerTransitions2.PromptCreateModel
              ),
            },
            [MlEphantManagerTransitions2.PromptEditModel]: {
              ...invokeTransition(MlEphantManagerTransitions2.PromptEditModel),
            },
          },
        },
      },
    },
  },
})

export type MlEphantManagerActor2 = ActorRefFrom<typeof mlEphantManagerMachine2>
export const MlEphantMachineContext = createActorContext<MlEphantManagerActor2>(
  mlEphantManagerMachine2
)
