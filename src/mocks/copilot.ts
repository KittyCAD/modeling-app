import type {
  MlCopilotServerMessage,
  ReasoningMessage,
  MlToolResult,
} from '@kittycad/lib'

const ALPHA = 'abcdefghijklmnopqrstuvwyz     '.split('')
const EMOJI = ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥲', '🥹', '☺']

const stringRand = (set: string[], len: number): string => {
  return new Array(len)
    .fill('')
    .map((_) => set[Math.floor(Math.random() * set.length)])
    .join('')
}

const delta = (): MlCopilotServerMessage & { delta: any } => {
  return {
    delta: { delta: stringRand(ALPHA, Math.trunc(Math.random() * 50) + 10) },
  }
}

const toolOutput = (): Extract<
  MlCopilotServerMessage,
  { tool_output: any }
> => {
  const outputs: MlToolResult[] = [
    {
      outputs: {
        ['main' + '.kcl']: stringRand(ALPHA, Math.trunc(Math.random() * 500)),
        ['main2' + '.kcl']: stringRand(ALPHA, Math.trunc(Math.random() * 500)),
      },
      project_name: 'untitled-1',
      status_code: 200,
      type: 'text_to_cad',
    },
    {
      outputs: {
        ['main' + '.kcl']: stringRand(ALPHA, Math.trunc(Math.random() * 500)),
        ['main2' + '.kcl']: stringRand(ALPHA, Math.trunc(Math.random() * 500)),
      },
      project_name: 'untitled-1',
      status_code: 200,
      type: 'edit_kcl_code',
    },
    { response: stringRand(ALPHA, 100), type: 'mechanical_knowledge_base' },
  ]

  const toolOutputChoice = outputs[Math.trunc(Math.random() * 4)]
  return {
    tool_output: {
      result: {
        ...toolOutputChoice,
      },
    },
  }
}

const error = (): MlCopilotServerMessage & { error: any } => {
  return {
    error: {
      detail: stringRand(ALPHA, Math.trunc(Math.random() * 80) + 10),
    },
  }
}

const info = (): MlCopilotServerMessage & { info: any } => {
  return {
    info: {
      text: stringRand(ALPHA, Math.trunc(Math.random() * 80) + 10),
    },
  }
}

const reasoning = (): Extract<MlCopilotServerMessage, { reasoning: any }> => {
  const outputs: ReasoningMessage[] = [
    ...new Array(18).fill(undefined).map(() => ({
      content: stringRand(EMOJI, 1) + ' ' + stringRand(ALPHA, 40),
      type: 'text' as const,
    })),
    { content: stringRand(ALPHA.concat('\n'), 200), type: 'kcl_docs' as const },
    {
      content: stringRand(ALPHA.concat('\n'), 200),
      type: 'kcl_code_examples' as const,
    },
    {
      content: stringRand(ALPHA.concat('\n'), 100),
      type: 'feature_tree_outline' as const,
    },
    {
      steps: [
        {
          edit_instructions: stringRand(ALPHA, 50),
          filepath_to_edit: stringRand(ALPHA, 30) + '.kcl',
        },
        {
          edit_instructions: stringRand(ALPHA, 50),
          filepath_to_edit: stringRand(ALPHA, 30) + '.kcl',
        },
        {
          edit_instructions: stringRand(ALPHA, 50),
          filepath_to_edit: stringRand(ALPHA, 30) + '.kcl',
        },
      ],
      type: 'design_plan',
    },
    {
      code: stringRand(ALPHA.concat('\n'), 200),
      type: 'generated_kcl_code' as const,
    },
    { error: stringRand(ALPHA, 60), type: 'kcl_code_error' as const },
    {
      content: stringRand(ALPHA.concat('\n'), 200),
      file_name: stringRand(ALPHA, 30) + '.kcl',
      type: 'created_kcl_file' as const,
    },
    {
      content: stringRand(ALPHA.concat('\n'), 200),
      file_name: stringRand(ALPHA, 30) + '.kcl',
      type: 'updated_kcl_file' as const,
    },
    {
      file_name: stringRand(ALPHA, 30) + '.kcl',
      type: 'deleted_kcl_file' as const,
    },
  ]

  return {
    reasoning: {
      ...outputs[Math.floor(Math.random() * outputs.length)],
    },
  }
}

const endOfStream = (): MlCopilotServerMessage & { end_of_stream: any } => {
  return {
    end_of_stream: {
      whole_response: stringRand(ALPHA, Math.trunc(Math.random() * 80)),
    },
  }
}

const generators = {
  reasoning: [
    toolOutput,
    toolOutput,
    toolOutput,
    toolOutput,
    toolOutput,
    reasoning,
    reasoning,
    reasoning,
  ],
  conversation: [delta],
}

function generateCopilotReasoning(): MlCopilotServerMessage {
  const index = Math.floor(Math.random() * generators.reasoning.length)
  return generators.reasoning[index]()
}

function generateCopilotConversation(): MlCopilotServerMessage {
  const index = Math.floor(Math.random() * generators.conversation.length)
  return generators.conversation[index]()
}

type WebSocketEventListenerMap = {
  [Ev in keyof WebSocketEventMap]: (
    this: MockSocket,
    event: WebSocketEventMap[Ev]
  ) => void
}

const isWebSocketEventType = (
  target: keyof WebSocketEventMap,
  type: keyof WebSocketEventMap,
  listener: WebSocketEventListenerMap[keyof WebSocketEventMap]
): listener is WebSocketEventListenerMap[typeof target] => {
  return type === target
}

export class MockSocket extends WebSocket {
  private cbs: {
    [Ev in keyof WebSocketEventMap]: WebSocketEventListenerMap[Ev][]
  } = {
    error: [],
    open: [],
    close: [],
    message: [],
  }

  constructor(public url: string) {
    try {
      super('') // This WILL throw. '' is not a valid URL.
    } catch (e: unknown) {
      console.error(e)
    }
  }

  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: WebSocketEventListenerMap[K]
  ) {
    if (isWebSocketEventType('open', type, listener)) {
      listener.bind(this)(new Event('', {}))
    } else if (isWebSocketEventType('message', type, listener)) {
      this.cbs.message.push(listener)
    } else if (isWebSocketEventType('close', type, listener)) {
      this.cbs.close.push(listener)
    }
  }

  send(payload: string) {
    const obj = JSON.parse(payload)

    let response: MlCopilotServerMessage
    if (obj.type === 'system' && obj.command === 'new') {
      // response = { conversation_id: { conversation_id: 'satehusateohustahseut' }}
    }

    if (obj.type === 'user') {
      const iterations = Math.trunc(Math.random() * 18) + 7
      let i = 0
      const loop = (fn: () => MlCopilotServerMessage) => {
        setTimeout(() => {
          if (i >= iterations) {
            return
          }

          response = i === iterations - 1 ? endOfStream() : fn()

          for (let cb of this.cbs.message) {
            cb.bind(this)(
              new MessageEvent('message', { data: JSON.stringify(response) })
            )
          }

          i += 1
          loop(
            i < Math.floor(iterations / 1.25)
              ? generateCopilotReasoning
              : generateCopilotConversation
          )
        }, 500)
      }

      loop(generateCopilotReasoning)
    }
  }
}
