import type { Models } from '@kittycad/lib'
import {
  logger,
  EngineConnectionEvents,
  toRTCSessionDescriptionInit,
} from './utils'
import { ConnectionManager } from './connectionManager'

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
}: {
  send: (message: Models['WebSocketRequest_type']) => void
  token: string | undefined
}) => {
  const onWebSocketOpen = (event: Event) => {
    // TODO: hmmm I do not like this pattern
    // This is required for when the app is running stand-alone / within desktop app.
    // Otherwise when run in a browser, the token is sent implicitly via
    // the Cookie header.
    if (token) {
      send({
        type: 'headers',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      // TODO: Why? Why would this need to send a ping?
      // Why not start the pingPong Interval
      // TODO: Send an initial ping
    }
  }
  return onWebSocketOpen
}

export const createOnWebSocketError = () => {
  const onWebSocketError = (event: Event) => {
    logger('onwebsocketerror', event)

    if (event.target instanceof WebSocket) {
      // WS error
      // TODO: this.state = {}
      // well what the fuck?
    }
  }

  return onWebSocketError
}

export const createOnWebSocketMessage = ({
  connectionManager,
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
}: {
  connectionManager: ConnectionManager
  disconnectAll: () => void
  setPong: (pong: number) => void
  dispatchEvent: (event: Event) => boolean
  ping: () => number | undefined
  setPing: (pong: number | undefined) => void
  createPeerConnection: () => RTCPeerConnection
  send: (message: Models['WebSocketRequest_type']) => void
  setSdpAnswer: (answer: RTCSessionDescriptionInit) => void
  initiateConnectionExclusive: () => void
  addIceCandidate: (candidate: RTCIceCandidateInit) => void
  webrtcStatsCollector: () => Promise<ClientMetrics>
}) => {
  const onWebSocketMessage = async (event: MessageEvent<any>) => {
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
        const pendingCommand =
          connectionManager.pendingCommands[message.request_id]
        console.error(
          `Error in response to request ${message.request_id}:\n${errorsString}\n\nPending command:\n${JSON.stringify(
            pendingCommand,
            null,
            2
          )}`
        )
      } else {
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

    // Message is succesfull, lets process the websocket message
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
        logger(`API Call ID: ${apiCallId}`, {})
        break
      // Only fires on successful authentication.
      case 'ice_server_info':
        const iceServers = resp.data.ice_servers
        // Now that we have some ICE servers it makes sense
        // to start initializing the RTCPeerConnection. RTCPeerConnection
        // will begin the ICE process.

        // You have reference!
        const peerConnection = createPeerConnection()

        if (iceServers.length === 0) {
          console.warn('No ICE servers')
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

        // We have an ICE Servers set now. We just setConfiguration, so let's
        // start adding things we care about to the PeerConnection and let
        // ICE negotiation happen in the background. Everything from here
        // until the end of this function is setup of our end of the
        // PeerConnection and waiting for events to fire our callbacks.

        // Add a transceiver to our SDP offer
        peerConnection.addTransceiver('vide', {
          direction: 'recvonly',
        })

        // Create a session description offer based on our local environment
        // that we will send to the remote end. The remote will send back
        // what it supports via sdp_answer.
        try {
          const offer = await peerConnection.createOffer()
          // This was not error handled before!
          await peerConnection.setLocalDescription(offer)
          send({
            type: 'sdp_offer',
            offer: offer as Models['RtcSessionDescription_type'],
          })
        } catch (e) {
          disconnectAll()
        }
        break
      case 'sdp_answer':
        const answer = resp.data.answer
        if (!answer || answer.type === 'unspecified') {
          return
        }

        const sdpAnswer = toRTCSessionDescriptionInit(answer)

        // sdpAnswer was not handled if undefined!
        if (!sdpAnswer) {
          throw new Error('NO NO SDP ANSWER')
        }

        setSdpAnswer(sdpAnswer)

        // We might have received this after ice candidates finish
        // Make sure we attempt to connect when we do.
        initiateConnectionExclusive()
        break
      case 'trickle_ice':
        const candidate = resp.data.candidate
        addIceCandidate(candidate)
        break
      case 'metrics_request':
        try {
          const clientMetrics = await webrtcStatsCollector()
          send({
            type: 'metrics_response',
            metrics: clientMetrics,
          })
        } catch (e) {
          console.error(e)
        }
        break
    }
  }
}
