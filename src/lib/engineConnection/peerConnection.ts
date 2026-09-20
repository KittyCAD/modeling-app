import type {
  ClientMetrics,
  WebSocketRequest,
} from '@kittycad/lib/dist/types/src'
import {
  ClientErrorCode,
  errorToMessage,
  reportClientError,
} from '@src/lib/clientErrors'
import { EngineDebugger } from '@src/lib/debugger'
import type { Connection } from '@src/lib/engineConnection/connection'
import type {
  IEventListenerTracked,
  ManagerTearDown,
} from '@src/lib/engineConnection/utils'
import {
  ConnectingType,
  EngineConnectionEvents,
  EngineConnectionStateType,
} from '@src/lib/engineConnection/utils'
import { markOnce } from '@src/lib/performance'
import { reportRejection } from '@src/lib/trap'

export function createOnIceCandidate({
  initiateConnectionExclusive,
  send,
  setTimeoutToForceConnectId,
  dispatchEvent,
}: {
  initiateConnectionExclusive: () => Promise<undefined>
  send: (message: WebSocketRequest) => void
  setTimeoutToForceConnectId: (id: ReturnType<typeof setTimeout>) => void
  dispatchEvent: (event: Event) => boolean
}) {
  const onIceCandidate = (event: RTCPeerConnectionIceEvent) => {
    EngineDebugger.addLog({
      label: 'onIceCandidate',
      message: 'icecandidate',
      metadata: { candidate: event.candidate },
    })
    // This is null when the ICE gathering state is done.
    // Windows ONLY uses this to signal it's done!
    if (event.candidate === null) {
      initiateConnectionExclusive().catch(reportRejection)
      return
    }

    dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: ConnectingType.ICECandidateReceived,
          },
        },
      })
    )

    send({
      type: 'trickle_ice',
      candidate: {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid || undefined,
        sdpMLineIndex: event.candidate.sdpMLineIndex || undefined,
        usernameFragment: event.candidate.usernameFragment || undefined,
      },
    })

    EngineDebugger.addLog({
      label: 'onIceCandidate',
      message: 'send(trickle_ice)',
      metadata: { candidate: event.candidate },
    })

    // Sometimes the remote end doesn't report the end of candidates.
    // They have 3 seconds to.
    const id = setTimeout(() => {
      initiateConnectionExclusive().catch(reportRejection)
      console.warn('attempting initiateConnectionExclusive after 3 seconds')
      EngineDebugger.addLog({
        label: 'onIceCandidate',
        message: 'initiateConnectionExclusive after 3 seconds',
        metadata: { candidate: event.candidate },
      })
    }, 3000)
    setTimeoutToForceConnectId(id)
  }

  return onIceCandidate
}

export function createOnIceGatheringStateChange({
  initiateConnectionExclusive,
}: {
  initiateConnectionExclusive: () => Promise<unknown>
}) {
  const onIceGatheringStateChange = (event: Event) => {
    EngineDebugger.addLog({
      label: 'onIceGatheringStateChange',
      message: 'icegatheringstatechange',
      metadata: { event },
    })
    // Gotcha: This is invoked here because sdpAnswer could be done by the time this is called
    // or it could not be done. Who knows!
    initiateConnectionExclusive().catch(reportRejection)
  }

  return onIceGatheringStateChange
}

export function createOnIceConnectionStateChange() {
  const onIceConnectionStateChange = (event: Event) => {
    EngineDebugger.addLog({
      label: 'onIceConnectionStateChange',
      message: 'iceconnectionstatechange',
      metadata: { event },
    })
  }
  return onIceConnectionStateChange
}

export function createOnNegotiationNeeded() {
  const onNegotiationNeeded = (event: Event) => {
    EngineDebugger.addLog({
      label: 'onNegotiationNeeded',
      message: 'negotiationneeded',
      metadata: { event },
    })
  }
  return onNegotiationNeeded
}

export function createOnSignalingStateChange() {
  const onSignalingStateChange = (event: Event) => {
    EngineDebugger.addLog({
      label: 'onSignalingStateChange',
      message: 'signalingstatechange',
      metadata: { event },
    })
  }
  return onSignalingStateChange
}

export function createOnIceCandidateError() {
  const onIceCandidateError = (_event: Event) => {
    const event = _event as RTCPeerConnectionIceErrorEvent
    const message = `ICE candidate returned an error: ${event.errorCode}: ${event.errorText} for ${event.url}`
    console.warn(message)
    EngineDebugger.addLog({
      label: 'onIceCandidateError',
      message,
      metadata: { event },
    })
  }
  return onIceCandidateError
}

type WebrtcDisconnectRoute =
  | 'data-channel-closed'
  | 'peer-connection-failed'
  | 'peer-connection-disconnected'
  | 'peer-connection-closed'

async function reportWebrtcDisconnect({
  connection,
  peerConnection,
  route,
  initiatedBy,
}: {
  connection: Connection
  peerConnection: RTCPeerConnection
  route: WebrtcDisconnectRoute
  initiatedBy: ManagerTearDown['initiatedBy']
}) {
  const sourceTime = new Date().toISOString()
  const state = {
    peerConnectionState: peerConnection.connectionState,
    iceConnectionState: peerConnection.iceConnectionState,
    iceGatheringState: peerConnection.iceGatheringState,
    signalingState: peerConnection.signalingState,
    sctpTransportState: peerConnection.sctp?.state ?? null,
    dtlsTransportState: peerConnection.sctp?.transport.state ?? null,
    iceTransportState:
      peerConnection.sctp?.transport.iceTransport.state ?? null,
  }
  const statsDiagnostics: Record<string, unknown> = {}

  try {
    const stats = await peerConnection.getStats()
    const reports = Array.from(stats.values())
    const transport = reports.find((report) => report.type === 'transport')
    const pair = transport?.selectedCandidatePairId
      ? stats.get(transport.selectedCandidatePairId)
      : reports.find(
          (report) =>
            report.type === 'candidate-pair' &&
            report.nominated &&
            report.state === 'succeeded'
        )
    const inbound = reports.find(
      (report) => report.type === 'inbound-rtp' && report.kind === 'video'
    )
    const localCandidate = pair ? stats.get(pair.localCandidateId) : undefined
    const remoteCandidate = pair ? stats.get(pair.remoteCandidateId) : undefined

    Object.assign(statsDiagnostics, {
      statsCollected: true,
      selectedCandidatePairState: pair?.state ?? null,
      selectedCandidatePairNominated: pair?.nominated ?? null,
      selectedCandidatePairRtt: pair?.currentRoundTripTime ?? null,
      selectedCandidatePairBytesReceived: pair?.bytesReceived ?? null,
      selectedCandidatePairBytesSent: pair?.bytesSent ?? null,
      selectedCandidatePairRequestsSent: pair?.requestsSent ?? null,
      selectedCandidatePairResponsesReceived: pair?.responsesReceived ?? null,
      selectedCandidatePairConsentRequestsSent:
        pair?.consentRequestsSent ?? null,
      selectedCandidatePairLastPacketReceived:
        pair?.lastPacketReceivedTimestamp ?? null,
      selectedCandidatePairLastPacketSent:
        pair?.lastPacketSentTimestamp ?? null,
      localCandidateType: localCandidate?.candidateType ?? null,
      localCandidateProtocol: localCandidate?.protocol ?? null,
      localCandidateRelayProtocol: localCandidate?.relayProtocol ?? null,
      remoteCandidateType: remoteCandidate?.candidateType ?? null,
      remoteCandidateProtocol: remoteCandidate?.protocol ?? null,
      inboundVideoPacketsReceived: inbound?.packetsReceived ?? null,
      inboundVideoPacketsLost: inbound?.packetsLost ?? null,
      inboundVideoBytesReceived: inbound?.bytesReceived ?? null,
      inboundVideoFramesDecoded: inbound?.framesDecoded ?? null,
      inboundVideoFramesDropped: inbound?.framesDropped ?? null,
    })
  } catch (error) {
    Object.assign(statsDiagnostics, {
      statsCollected: false,
      statsCollectionError: errorToMessage(error),
    })
  }

  await reportClientError({
    code: ClientErrorCode.EngineWebrtcDisconnect,
    message: `WebRTC disconnected: ${route}.`,
    dedupeKey: `engine-webrtc-disconnect:${connection.id}`,
    extra: {
      source: 'RTCPeerConnection',
      sourceTime,
      shutdownRoute: route,
      initiatedBy,
      connectionId: connection.id,
      modelingApiCallId: connection.apiCallId ?? null,
      ...state,
      ...statsDiagnostics,
    },
  })
}

export function createOnConnectionStateChange({
  dispatchEvent,
  connection,
  tearDownManager,
}: {
  dispatchEvent: (event: Event) => boolean
  connection: Connection
  tearDownManager: (options: ManagerTearDown) => void
}) {
  // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionstatechange_event
  // Event type: generic Event type...
  const onConnectionStateChange = (event: Event) => {
    const peerConnection = event.target as RTCPeerConnection
    EngineDebugger.addLog({
      label: 'onConnectionStateChange',
      message: 'connectionstatechange',
      metadata: {
        event,
        connectionState: peerConnection.connectionState,
        iceConnectionState: peerConnection.iceConnectionState,
        iceGatheringState: peerConnection.iceGatheringState,
        signalingState: peerConnection.signalingState,
      },
    })

    const tearDownForWebrtcState = (route: WebrtcDisconnectRoute) => {
      const initiatedBy =
        route === 'peer-connection-closed' ? 'client' : 'unknown'
      const options: ManagerTearDown = { route, initiatedBy }
      if (connection.recordShutdownTrigger(options)) {
        void reportWebrtcDisconnect({
          connection,
          peerConnection,
          route,
          initiatedBy,
        }).catch(reportRejection)
      }
      tearDownManager(options)
    }

    switch (peerConnection.connectionState) {
      // From what I understand, only after have we done the ICE song and
      // dance is it safest to connect the video tracks / stream
      case 'connected':
        dispatchEvent(
          new CustomEvent(EngineConnectionEvents.NewTrack, {
            detail: { conn: connection, mediaStream: connection.mediaStream },
          })
        )
        break
      case 'connecting':
        break
      case 'failed':
        dispatchEvent(new CustomEvent(EngineConnectionEvents.Offline, {}))
        tearDownForWebrtcState('peer-connection-failed')
        break
      case 'disconnected':
        dispatchEvent(new CustomEvent(EngineConnectionEvents.Offline, {}))
        tearDownForWebrtcState('peer-connection-disconnected')
        break
      case 'closed':
        dispatchEvent(new CustomEvent(EngineConnectionEvents.Offline, {}))
        tearDownForWebrtcState('peer-connection-closed')
        break
      default:
        break
    }
  }

  return onConnectionStateChange
}

export function createOnTrack({
  setMediaStream,
  setWebrtcStatsCollector,
  peerConnection,
  deferredMediaStreamAndWebrtcStatsCollectorResolve,
  dispatchEvent,
}: {
  setMediaStream: (mediaStream: MediaStream) => void
  setWebrtcStatsCollector: (
    webrtcStatsCollector: () => Promise<ClientMetrics>
  ) => void
  peerConnection: RTCPeerConnection
  deferredMediaStreamAndWebrtcStatsCollectorResolve: (value: unknown) => void
  dispatchEvent: (event: Event) => boolean
}) {
  const onTrack = (event: RTCTrackEvent) => {
    EngineDebugger.addLog({
      label: 'onTrack',
      message: 'RTCTrackEvent',
      metadata: { event },
    })
    const mediaStream = event.streams[0]
    setMediaStream(mediaStream)
    const webrtcStatusCollector = createWebrtcStatsCollector({
      mediaStream,
      peerConnection,
    })
    setWebrtcStatsCollector(webrtcStatusCollector)
    deferredMediaStreamAndWebrtcStatsCollectorResolve(true)
    dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: ConnectingType.TrackReceived,
          },
        },
      })
    )
  }
  return onTrack
}

export function createWebrtcStatsCollector({
  mediaStream,
  peerConnection,
}: {
  mediaStream: MediaStream
  peerConnection: RTCPeerConnection
}) {
  const webrtcStatsCollector = (): Promise<ClientMetrics> => {
    return new Promise((resolve, reject) => {
      if (mediaStream.getVideoTracks().length !== 1) {
        reject(new Error('too many video tracks to report'))
        return
      }

      const inboundVideoTrack = mediaStream.getVideoTracks()[0]
      peerConnection
        .getStats()
        .then((stats) => {
          const metrics: ClientMetrics = {}

          stats.forEach((report, id) => {
            if (report.type === 'candidate-pair') {
              if (report.state == 'succeeded') {
                const rtt = report.currentRoundTripTime
                metrics.rtc_stun_rtt_sec = rtt
              }
            } else if (report.type === 'inbound-rtp') {
              // TODO(paultag): Since we can technically have multiple WebRTC
              // video tracks (even if the Server doesn't at the moment), we
              // ought to send stats for every video track(?), and add the stream
              // ID into it.  This raises the cardinality of collected metrics
              // when/if we do.
              // For now we just take one of the video tracks.
              if (report.trackIdentifier !== inboundVideoTrack.id) {
                return
              }

              metrics.rtc_frames_decoded = report.framesDecoded
              metrics.rtc_frames_dropped = report.framesDropped
              metrics.rtc_frames_received = report.framesReceived
              metrics.rtc_frames_per_second = report.framesPerSecond
              metrics.rtc_freeze_count = report.freezeCount
              metrics.rtc_jitter_sec = report.jitter
              metrics.rtc_keyframes_decoded = report.keyFramesDecoded
              metrics.rtc_total_freezes_duration_sec =
                report.totalFreezesDuration
              metrics.rtc_frame_height = report.frameHeight
              metrics.rtc_frame_width = report.frameWidth
              metrics.rtc_packets_lost = report.packetsLost
              metrics.rtc_pli_count = report.pliCount
            }
            // The following report types exist, but are unused:
            // data-channel, transport, certificate, peer-connection, local-candidate, remote-candidate, codec
          })

          resolve(metrics)
        })
        .catch(reportRejection)
    })
  }

  return webrtcStatsCollector
}

export const createOnDataChannel = ({
  connection,
  peerConnection,
  setUnreliableDataChannel,
  dispatchEvent,
  trackListener,
  startPingPong,
  connectionPromiseResolve,
  handleOnDataChannelMessage,
  tearDownManager,
}: {
  connection: Connection
  peerConnection: RTCPeerConnection
  setUnreliableDataChannel: (channel: RTCDataChannel) => void
  dispatchEvent: (event: Event) => boolean
  trackListener: (
    name: string,
    eventListenerTracked: IEventListenerTracked
  ) => void
  startPingPong: () => void
  connectionPromiseResolve: (value: unknown) => void
  handleOnDataChannelMessage: (event: MessageEvent<any>) => void
  tearDownManager: (options: ManagerTearDown) => void
}) => {
  const onDataChannel = (event: RTCDataChannelEvent) => {
    dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: ConnectingType.DataChannelConnecting,
            value: event.channel.label,
          },
        },
      })
    )
    // Initialize the event.channel with 4 event listeners
    const onDataChannelOpen = createOnDataChannelOpen({
      dispatchEvent,
      startPingPong,
      connectionPromiseResolve,
    })
    const onDataChannelError = createOnDataChannelError()
    const onDataChannelMessage = createOnDataChannelMessage({
      handleOnDataChannelMessage,
    })
    const onDataChannelClose = createOnDataChannelClose({
      connection,
      peerConnection,
      unreliableDataChannel: event.channel,
      onDataChannelOpen,
      onDataChannelError,
      onDataChannelMessage,
      tearDownManager,
    })

    const metaClose = () => {
      onDataChannelClose()
    }

    trackListener('unreliabledatachannel-open', {
      event: 'open',
      callback: onDataChannelOpen,
      type: 'unreliableDataChannel',
    })
    event.channel.addEventListener('open', onDataChannelOpen)
    trackListener('unreliabledatachannel-error', {
      event: 'error',
      callback: onDataChannelError,
      type: 'unreliableDataChannel',
    })
    event.channel.addEventListener('error', onDataChannelError)
    trackListener('unreliabledatachannel-message', {
      event: 'message',
      callback: onDataChannelMessage,
      type: 'unreliableDataChannel',
    })
    event.channel.addEventListener('message', onDataChannelMessage)
    trackListener('unreliabledatachannel-close', {
      event: 'close',
      callback: metaClose,
      type: 'unreliableDataChannel',
    })
    event.channel.addEventListener('close', metaClose)

    // event.channel is available and we initialize listeners on it.
    setUnreliableDataChannel(event.channel)
  }

  return onDataChannel
}

/**
 * When data channel is created
 *  onDataChannelOpen
 *  onDataChannelClose
 *  onDataChannelError
 *  onDataChannelMessage
 */
export const createOnDataChannelOpen = ({
  dispatchEvent,
  startPingPong,
  connectionPromiseResolve,
}: {
  dispatchEvent: (event: Event) => boolean
  startPingPong: () => void
  connectionPromiseResolve: (value: unknown) => void
}) => {
  const onDataChannelOpen = (event: Event) => {
    // Start firing off engine commands at this point.
    // They could be fired at an earlier time, onWebSocketOpen,
    // but DataChannel can offer some benefits like speed,
    // and it's nice to say everything's connected before interacting
    // with the server.
    dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: {
          type: EngineConnectionStateType.Connecting,
          value: {
            type: ConnectingType.DataChannelEstablished,
          },
        },
      })
    )

    EngineDebugger.addLog({
      label: 'onDataChannelOpen',
      message: 'ondatachannelopen',
      metadata: { event },
    })

    startPingPong()
    markOnce('code/endInitialEngineConnect')
    connectionPromiseResolve(true)

    // One part of the equation to enable the toolbar buttons
    dispatchEvent(
      new CustomEvent(EngineConnectionEvents.ConnectionStateChanged, {
        detail: {
          type: EngineConnectionStateType.ConnectionEstablished,
        },
      })
    )
  }
  return onDataChannelOpen
}

export const createOnDataChannelError = () => {
  const onDataChannelError = (event: Event) => {
    EngineDebugger.addLog({
      label: 'onDataChannelError',
      message: 'ondatachannelerror',
      metadata: { event },
    })
  }
  return onDataChannelError
}

export const createOnDataChannelMessage = ({
  handleOnDataChannelMessage,
}: {
  handleOnDataChannelMessage: (event: MessageEvent<any>) => void
}) => {
  const onDataChannelMessage = (event: MessageEvent<any>) => {
    // handle this in a parent function
    handleOnDataChannelMessage(event)
  }
  return onDataChannelMessage
}

export const createOnDataChannelClose = ({
  connection,
  peerConnection,
  unreliableDataChannel,
  onDataChannelOpen,
  onDataChannelError,
  onDataChannelMessage,
  tearDownManager,
}: {
  connection: Connection
  peerConnection: RTCPeerConnection
  unreliableDataChannel: RTCDataChannel
  onDataChannelOpen: (event: Event) => void
  onDataChannelError: (event: Event) => void
  onDataChannelMessage: (event: MessageEvent<any>) => void
  tearDownManager: (options: ManagerTearDown) => void
}) => {
  const onDataChannelClose = () => {
    EngineDebugger.addLog({
      label: 'onDataChannelClose',
      message: 'RTCPeerConnection data channel processed a closed event.',
    })
    unreliableDataChannel.removeEventListener('open', onDataChannelOpen)
    unreliableDataChannel.removeEventListener('error', onDataChannelError)
    unreliableDataChannel.removeEventListener('message', onDataChannelMessage)
    const options: ManagerTearDown = {
      route: 'data-channel-closed',
      initiatedBy: 'unknown',
    }
    if (connection.recordShutdownTrigger(options)) {
      void reportWebrtcDisconnect({
        connection,
        peerConnection,
        route: 'data-channel-closed',
        initiatedBy: options.initiatedBy,
      }).catch(reportRejection)
    }
    tearDownManager(options)
  }
  return onDataChannelClose
}
