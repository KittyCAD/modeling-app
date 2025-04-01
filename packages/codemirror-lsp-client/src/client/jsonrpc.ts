import * as jsrpc from 'json-rpc-2.0'
import * as LSP from 'vscode-languageserver-protocol'

import { Codec, FromServer, IntoServer } from './codec'
import {
  registerServerCapability,
  unregisterServerCapability,
} from './server-capability-registration'

const client_capabilities: LSP.ClientCapabilities = {
  textDocument: {
    hover: {
      dynamicRegistration: true,
      contentFormat: ['plaintext', 'markdown'],
    },
    moniker: {},
    synchronization: {
      dynamicRegistration: true,
      willSave: false,
      didSave: false,
      willSaveWaitUntil: false,
    },
    completion: {
      dynamicRegistration: true,
      completionItem: {
        snippetSupport: false,
        commitCharactersSupport: true,
        documentationFormat: ['plaintext', 'markdown'],
        deprecatedSupport: false,
        preselectSupport: false,
      },
      contextSupport: false,
    },
    signatureHelp: {
      dynamicRegistration: true,
      signatureInformation: {
        documentationFormat: ['plaintext', 'markdown'],
      },
    },
    declaration: {
      dynamicRegistration: true,
      linkSupport: true,
    },
    definition: {
      dynamicRegistration: true,
      linkSupport: true,
    },
    typeDefinition: {
      dynamicRegistration: true,
      linkSupport: true,
    },
    implementation: {
      dynamicRegistration: true,
      linkSupport: true,
    },
  },
  workspace: {
    didChangeConfiguration: {
      dynamicRegistration: true,
    },
  },
}

export default class Client extends jsrpc.JSONRPCServerAndClient {
  afterInitializedHooks: (() => Promise<void>)[] = []
  #fromServer: FromServer
  private serverCapabilities: LSP.ServerCapabilities<any> = {}
  private notifyFn: ((message: LSP.NotificationMessage) => void) | null = null
  private initializedCallback: () => void

  constructor(
    fromServer: FromServer,
    intoServer: IntoServer,
    initializedCallback: () => void
  ) {
    super(
      new jsrpc.JSONRPCServer(),
      new jsrpc.JSONRPCClient(async (json: jsrpc.JSONRPCRequest) => {
        const encoded = Codec.encode(json)
        intoServer.enqueue(encoded)
        if (null != json.id) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const response = await fromServer.responses.get(json.id)
          this.client.receive(response as jsrpc.JSONRPCResponse)
        }
      })
    )
    this.#fromServer = fromServer
    this.initializedCallback = initializedCallback
  }

  async start(): Promise<void> {
    // process "window/logMessage": client <- server
    this.addMethod(LSP.LogMessageNotification.type.method, (params) => {
      const { type, message } = params as {
        type: LSP.MessageType
        message: string
      }
      let messageString = ''
      switch (type) {
        case LSP.MessageType.Error: {
          messageString += '[error] '
          break
        }
        case LSP.MessageType.Warning: {
          messageString += ' [warn] '
          break
        }
        case LSP.MessageType.Info: {
          messageString += ' [info] '
          break
        }
        case LSP.MessageType.Log: {
          messageString += '  [log] '
          break
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      messageString += message
      return
    })

    // process "client/registerCapability": client <- server
    this.addMethod(LSP.RegistrationRequest.type.method, (params) => {
      // Register a server capability.
      params.registrations.forEach(
        (capabilityRegistration: LSP.Registration) => {
          const caps = registerServerCapability(
            this.serverCapabilities,
            capabilityRegistration
          )
          if (caps instanceof Error) {
            return (this.serverCapabilities = {})
          }
          this.serverCapabilities = caps
        }
      )
    })

    // process "client/unregisterCapability": client <- server
    this.addMethod(LSP.UnregistrationRequest.type.method, (params) => {
      // Unregister a server capability.
      params.unregisterations.forEach(
        (capabilityUnregistration: LSP.Unregistration) => {
          const caps = unregisterServerCapability(
            this.serverCapabilities,
            capabilityUnregistration
          )
          if (caps instanceof Error) {
            return (this.serverCapabilities = {})
          }
          this.serverCapabilities = caps
        }
      )
    })

    // request "initialize": client <-> server
    const { capabilities } = await this.request(
      LSP.InitializeRequest.type.method,
      {
        processId: null,
        clientInfo: {
          name: 'codemirror-lsp-client',
        },
        capabilities: client_capabilities,
        rootUri: null,
      } as LSP.InitializeParams
    )

    this.serverCapabilities = capabilities

    // notify "initialized": client --> server
    this.notify(LSP.InitializedNotification.type.method, {})

    this.initializedCallback()

    await Promise.all(
      this.afterInitializedHooks.map((f: () => Promise<void>) => f())
    )
    await Promise.all([this.processNotifications(), this.processRequests()])
  }

  getServerCapabilities(): LSP.ServerCapabilities<any> {
    return this.serverCapabilities
  }

  setNotifyFn(fn: (message: LSP.NotificationMessage) => void): void {
    this.notifyFn = fn
  }

  async processNotifications(): Promise<void> {
    for await (const notification of this.#fromServer.notifications) {
      if (this.notifyFn) {
        this.notifyFn(notification)
      }
    }
  }

  async processRequests(): Promise<void> {
    for await (const request of this.#fromServer.requests) {
      await this.receiveAndSend(request)
    }
  }

  pushAfterInitializeHook(...hooks: (() => Promise<void>)[]): void {
    this.afterInitializedHooks.push(...hooks)
  }
}
