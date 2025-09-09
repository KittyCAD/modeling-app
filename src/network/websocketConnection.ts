import type { Models } from '@kittycad/lib'
import type { ClientMetrics } from '@src/network/utils'
import {
  ConnectingType,
  EngineConnectionEvents,
  EngineConnectionStateType,
  toRTCSessionDescriptionInit,
} from '@src/network/utils'
import { EngineDebugger } from '@src/lib/debugger'
import { reportRejection } from '@src/lib/trap'

/**
 * 4 different event listeners to clean up
 * onWebSocketOpen
 * onWebSocketClose
 * onWebSocketError
 * onWebSocketMessage
 */

export const createOnWebSocketOpen = ({
  send,
  token,
  dispatchEvent,
}: {
  send: (message: Models['WebSocketRequest_type']) => void
  token: string | undefined
  dispatchEvent: (event: Event) => boolean
}) => {
  const onWebSocketOpen = (event: Event) => {
    // TODO: hmmm I do not like this pattern
    // This is required for when the app is running stand-alone / within desktop app.
    // Otherwise when run in a browser, the token is sent implicitly via
    // the Cookie header.
    if (token) {
      EngineDebugger.addLog({
        label: 'createOnWebSocketOpen',
        message: 'send headers bearer',
        metadata: { event },
      })
      send({
        type: 'headers',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      dispatchEvent(
        new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
          detail: {
            type: EngineConnectionStateType.Connecting,
            value: {
              type: ConnectingType.WebSocketOpen,
            },
          },
        })
      )
    }
  }
  return onWebSocketOpen
}

export const createOnWebSocketError = () => {
  const onWebSocketError = (event: Event) => {
    EngineDebugger.addLog({
      label: 'onWebSocketError',
      message: 'onwebsocketerror',
      metadata: { event },
    })

    if (event.target instanceof WebSocket) {
      // WS error
      // TODO: this.state = {}
      // well what the fuck?
    }
  }

  return onWebSocketError
}

export const createOnWebSocketMessage = ({
  disconnectAll,
  setPong,
  dispatchEvent,
  ping,
  setPing,
  createPeerConnection,
  send,
  setSdpAnswer,
  initiateConnectionExclusive,
  addIceCandidate,
  webrtcStatsCollector,
  sdpAnswerResolve,
  sdpAnswerReject,
}: {
  disconnectAll: () => void
  setPong: (pong: number) => void
  dispatchEvent: (event: Event) => boolean
  ping: () => number | undefined
  setPing: (pong: number | undefined) => void
  createPeerConnection: () => RTCPeerConnection | undefined
  send: (message: Models['WebSocketRequest_type']) => void
  setSdpAnswer: (answer: RTCSessionDescriptionInit) => void
  initiateConnectionExclusive: () => Promise<unknown>
  addIceCandidate: (candidate: RTCIceCandidateInit) => void
  webrtcStatsCollector: () => (() => Promise<ClientMetrics>) | undefined
  sdpAnswerResolve: (value: any) => void
  sdpAnswerReject: (value: any) => void
}) => {
  const onWebSocketMessage = (event: MessageEvent<any>) => {
    // In the EngineConnection, we're looking for messages to/from
    // the server that relate to the ICE handshake, or WebRTC
    // negotiation. There may be other messages (including ArrayBuffer
    // messages) that are intended for the GUI itself, so be careful
    // when assuming we're the only consumer or that all messages will
    // be carefully formatted here.

    if (typeof event.data !== 'string') {
      // TODO: What?
      return
    }

    const message: Models['WebSocketResponse_type'] = JSON.parse(event.data)

    if (!message.success) {
      const errorsString = message?.errors
        ?.map((error) => {
          return `  - ${error.error_code}: ${error.message}`
        })
        .join('\n')
      if (message.request_id) {
        console.error(
          `Error in response to request ${message.request_id}:\n${errorsString}\n}`
        )
      } else {
        /**
         * Gotcha one of the errors can be auth_token_missing: Please send `{ headers: { Authorization: "Bearer <token>" } }` over this websocket.
         * The moment we open the websocket the server can send this message before we have sent the headers or if they are
         * in transit. It can be misleading for a moment.
         * The server will spam ping you with this until you send them. If you see a few then it stops then you set the headers in the websocket safely.
         */
        console.error(`Error from server:\n${errorsString}`)
      }

      const firstError = message.errors[0]
      if (firstError.error_code === 'auth_token_invalid') {
        disconnectAll()
      }

      if (firstError.error_code === 'internal_api') {
        disconnectAll()
      }

      return
    }

    const resp = message.resp
    // If there's no body to the response, we can bail here.
    if (!resp || !resp.type) {
      return
    }

    // Message is successful, lets process the websocket message
    switch (resp.type) {
      case 'pong':
        const pong = Date.now()
        setPong(pong)
        dispatchEvent(
          new CustomEvent(EngineConnectionEvents.PingPongChanged, {
            detail: Math.min(999, Math.floor(pong - (ping() ?? 0))),
          })
        )
        setPing(undefined)
        break
      case 'modeling_session_data':
        const apiCallId = resp.data.session.api_call_id
        console.log(`API Call ID: ${apiCallId}`)
        EngineDebugger.addLog({
          label: 'onWebSocketMessage',
          message: 'modeling_session_data',
          metadata: { apiCallId },
        })

        break
      // Only fires on successful authentication.
      case 'ice_server_info':
        const iceServers = resp.data.ice_servers
        // Now that we have some ICE servers it makes sense
        // to start initializing the RTCPeerConnection. RTCPeerConnection
        // will begin the ICE process.

        // You have reference!
        const peerConnection = createPeerConnection()

        if (!peerConnection) {
          console.error('unable to create peer connection')
          EngineDebugger.addLog({
            label: 'onWebSocketMessage',
            message: 'ice_server_info',
            metadata: { error: 'unable to createPeerConnection' },
          })
          // TODO: Handle failure case
          return
        }

        EngineDebugger.addLog({
          label: 'onWebSocketMessage',
          message: 'createPeerConnection from ice_server_info',
          metadata: { event },
        })

        if (iceServers.length === 0) {
          console.warn('No ICE servers')
          EngineDebugger.addLog({
            label: 'onWebSocketMessage',
            message: 'No ICE servers',
            metadata: { event },
          })
          peerConnection.setConfiguration({
            bundlePolicy: 'max-bundle',
          })
        } else {
          // When we set the Configuration, we want to always force
          // iceTransportPolicy to 'relay', since we know the topology
          // of the ICE/STUN/TUN server and the engine. We don't wish to
          // talk to the engine in any configuration /other/ than relay
          // from a infra POV.
          peerConnection.setConfiguration({
            bundlePolicy: 'max-bundle',
            iceServers: iceServers,
            iceTransportPolicy: 'relay',
          })
        }
        dispatchEvent(
          new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
            detail: {
              type: EngineConnectionStateType.Connecting,
              value: {
                type: ConnectingType.ICEServersSet,
              },
            },
          })
        )

        // We have an ICE Servers set now. We just setConfiguration, so let's
        // start adding things we care about to the PeerConnection and let
        // ICE negotiation happen in the background. Everything from here
        // until the end of this function is setup of our end of the
        // PeerConnection and waiting for events to fire our callbacks.

        // Add a transceiver to our SDP offer
        peerConnection.addTransceiver('video', {
          direction: 'recvonly',
        })

        // Create a session description offer based on our local environment
        // that we will send to the remote end. The remote will send back
        // what it supports via sdp_answer.
        peerConnection
          .createOffer()
          .then((offer) => {
            peerConnection
              .setLocalDescription(offer)
              .then(() => {
                dispatchEvent(
                  new CustomEvent(
                    EngineConnectionEvents.ConnectionStateChanged,
                    {
                      detail: {
                        type: EngineConnectionStateType.Connecting,
                        value: {
                          type: ConnectingType.SetLocalDescription,
                        },
                      },
                    }
                  )
                )
                send({
                  type: 'sdp_offer',
                  offer: offer as Models['RtcSessionDescription_type'],
                })
                dispatchEvent(
                  new CustomEvent(
                    EngineConnectionEvents.ConnectionStateChanged,
                    {
                      detail: {
                        type: EngineConnectionStateType.Connecting,
                        value: {
                          type: ConnectingType.OfferedSdp,
                        },
                      },
                    }
                  )
                )
              })
              .catch((e) => {
                EngineDebugger.addLog({
                  label: 'onWebSocketMessage',
                  message: 'peerConnection.setLocalDescription(offer) failed',
                  metadata: { e },
                })
                disconnectAll()
              })
          })
          .catch((e) => {
            EngineDebugger.addLog({
              label: 'onWebSocketMessage',
              message: 'peerConnection.createOffer failed',
              metadata: { e },
            })
            disconnectAll()
          })
        break
      case 'sdp_answer':
        const answer = resp.data.answer
        if (!answer || answer.type === 'unspecified') {
          return
        }

        const sdpAnswer = toRTCSessionDescriptionInit(answer)

        // sdpAnswer was not handled if undefined!
        if (!sdpAnswer) {
          return sdpAnswerReject('sdpAnswer is undefined')
        }

        setSdpAnswer(sdpAnswer)
        sdpAnswerResolve(true)

        dispatchEvent(
          new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
            detail: {
              type: EngineConnectionStateType.Connecting,
              value: {
                type: ConnectingType.ReceivedSdp,
              },
            },
          })
        )

        // We might have received this after ice candidates finish
        // Make sure we attempt to connect when we do.
        initiateConnectionExclusive().catch(reportRejection)
        break
      case 'trickle_ice':
        const candidate = resp.data.candidate
        addIceCandidate(candidate)
        break
      case 'metrics_request':
        /**
         * Gotcha, metrics_request can be called before the webrtcStatsCollector
         * is initialized from the ice_server_info workflow. This means we need to drop these requests
         * until the function is initialized
         */
        const collector = webrtcStatsCollector()
        if (!collector) {
          EngineDebugger.addLog({
            label: 'onWebSocketMessage',
            message:
              'dropping metrics_request, webrtcStatsCollector is undefined',
            metadata: { event },
          })
          return
        }
        // webrtcStatsCollector is created from createPeerConnection
        // which is an event within this switch case so it is not easy
        // to have this be a sync workflow? You could have two onMessageHandlers
        // once the other one is created but that could be more confusing.
        collector()
          .then((clientMetrics) => {
            send({
              type: 'metrics_response',
              metrics: clientMetrics,
            })
          })
          .catch((e) => {
            console.error(e)
          })

        break
    }
  }

  return onWebSocketMessage
}

export const createOnWebSocketClose = ({
  websocket,
  onWebSocketOpen,
  onWebSocketError,
  onWebSocketMessage,
  tearDownManager,
  dispatchEvent,
}: {
  websocket: WebSocket
  onWebSocketOpen: (event: Event) => void
  onWebSocketError: (event: Event) => void
  onWebSocketMessage: (event: MessageEvent<any>) => void
  tearDownManager: () => void
  dispatchEvent: (event: Event) => boolean
}) => {
  const onDataChannelClose = () => {
    websocket.removeEventListener('open', onWebSocketOpen)
    websocket.removeEventListener('error', onWebSocketError)
    websocket.removeEventListener('message', onWebSocketMessage)
    dispatchEvent(new CustomEvent(EngineConnectionEvents.Offline, {}))
    tearDownManager()
  }
  return onDataChannelClose
}
