import type { MlCopilotServerMessage, ReasoningMessage, MlToolResult } from '@kittycad/lib'

const ALPHA = 'abcdefghijklmnopqrstuvwyz     '.split('')
const EMOJI = '🐶🐱🐭🐹🐰🦊🐻🐼🐨🦁🐯🐮🐷🐸🐵🐔🐧🐦🐤🐣🦆🦅'.split('')

const stringRand = (set: string[], len: number): string => {
  return new Array(len).fill('').map(_ => set[Math.floor(Math.random() * set.length)]).join('')
}

const delta = (): MlCopilotServerMessage & { delta: any }  => {
  return { delta: { delta: stringRand(ALPHA, Math.trunc(Math.random() * 50)) } }
}

const toolOutput = (): Extract<MlCopilotServerMessage, { tool_output: any }> => {
  const outputs: MlToolResult[]  = [
    { outputs: { ['main' + '.kcl']: stringRand(ALPHA, Math.trunc(Math.random()*500)) }, status_code: 200, type: 'text_to_cad' },
    { outputs: { ['main' + '.kcl']: stringRand(ALPHA, Math.trunc(Math.random()*500)) }, status_code: 200, type: 'edit_kcl_code' },
    { response: stringRand(ALPHA, 100), type: 'mechanical_knowledge_base' },
  ]

  const toolOutputChoice = outputs[Math.trunc(Math.random() * 4)]
  return {
    tool_output: {
      result: {
        ...toolOutputChoice
      }
    }
  }
}

const error = (): MlCopilotServerMessage & { error: any } => {
  return {
    error: {
      detail: stringRand(ALPHA, Math.trunc(Math.random() * 80))
    }
  }
}

const info = (): MlCopilotServerMessage & { info: any } => {
  return {
    info: {
      text: stringRand(ALPHA, Math.trunc(Math.random() * 80))
    }
  }
}



const reasoning  = (): Extract<MlCopilotServerMessage, { reasoning: any }>  => {
  const outputs: ReasoningMessage[]  = [
    ...new Array(18).fill(undefined).map(() => ({ content: stringRand(EMOJI, 1) + ' ' + stringRand(ALPHA, 60), type: 'text' as const })),
    {  content: '', type: 'kcl_docs' as const },
    {  content: '', type: 'kcl_code_examples' as const },
    {  content: '', type: 'feature_tree_outline' as const },
    {
      steps: [
        { edit_instructions: '', filepath_to_edit: '' },
        { edit_instructions: '', filepath_to_edit: '' },
        { edit_instructions: '', filepath_to_edit: '' },
      ],
      type: 'design_plan'
    },
    { code: '', type: 'generated_kcl_code' as const },
    { error: '', type: 'kcl_code_error' as const },
    { content: '', file_name: '', type: 'created_kcl_file' as const},
    { content: '', file_name: '', type: 'updated_kcl_file' as const},
    { file_name: '', type: 'deleted_kcl_file' as const},
  ]

  return {
    reasoning: {
      ...outputs[Math.floor(Math.random() * outputs.length)]
    }
  }
}

const endOfStream = (): MlCopilotServerMessage & { end_of_stream: any }  => {
  return {
    end_of_stream: {
      whole_response: stringRand(ALPHA, Math.trunc(Math.random() * 80))
    }
  }
}

const generators = [delta, toolOutput, error, info, reasoning, reasoning, reasoning, reasoning, reasoning]

function comeUpWithSemiRealisticCopilotOutput(): MlCopilotServerMessage {
 const index = Math.floor(Math.random() * generators.length)
 return generators[index]()
}

type WebSocketEventListenerMap = {
  [Ev in keyof WebSocketEventMap]: (this: MockSocket, event: WebSocketEventMap[Ev]) => void
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
    } catch(e: unknown) {}
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
      let i = 0;
      const loop = () => {
        setTimeout(() => {
          if (i >= iterations) return

          response = i === iterations - 1
            ? endOfStream()
            : comeUpWithSemiRealisticCopilotOutput()

          for (let cb of this.cbs.message) {
            cb.bind(this)(new MessageEvent('message', { data: JSON.stringify(response) }))
          }

          i += 1
          loop()
        }, Math.trunc(Math.random() * 3000))
      }

      loop()
    }
  }
}


