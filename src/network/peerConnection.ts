import type { ClientMetrics, UnreliableResponses } from './utils'
import { logger, EngineConnectionEvents } from './utils'
import type { Models } from '@kittycad/lib'
import type { Connection, IEventListenerTracked } from './connection'
import { EngineDebugger } from '@src/lib/debugger'
import { markOnce } from '@src/lib/performance'
import type { ConnectionManager } from './connectionManager'

export function createOnIceCandidate({
  initiateConnectionExclusive,
  send,
  setTimeoutToForceConnectId,
}: {
  initiateConnectionExclusive: () => void
  send: (message: Models['WebSocketRequest_type']) => void
  setTimeoutToForceConnectId: (id: ReturnType<typeof setTimeout>) => void
}) {
  const onIceCandidate = (event: RTCPeerConnectionIceEvent) => {
    logger('icecandidate', event.candidate)
    EngineDebugger.addLog({
      label: 'onIceCandidate',
      message: 'icecandidate',
      metadata: { candidate: event.candidate },
    })
    // This is null when the ICE gathering state is done.
    // Windows ONLY uses this to signal it's done!
    if (event.candidate === null) {
      initiateConnectionExclusive()
      return
    }

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
      initiateConnectionExclusive()
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
  initiateConnectionExclusive: () => void
}) {
  const onIceGatheringStateChange = (event: Event) => {
    logger('icegatheringstatechange', event)
    EngineDebugger.addLog({
      label: 'onIceGatheringStateChange',
      message: 'icegatheringstatechange',
      metadata: { event },
    })
    // Gotcha: This is invoked here because sdpAnswer could be done by the time this is called
    // or it could not be done. Who knows!
    initiateConnectionExclusive()
  }

  return onIceGatheringStateChange
}

export function createOnIceConnectionStateChange() {
  const onIceConnectionStateChange = (event: Event) => {
    logger('iceconnectionstatechange', event)
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
    logger('negotiationneeded', event)
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
    logger('signalingstatechange', event)
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

export function createOnConnectionStateChange({
  dispatchEvent,
  connection,
  disconnectAll,
  cleanUp,
}: {
  dispatchEvent: (event: Event) => boolean
  connection: Connection
  disconnectAll: () => void
  cleanUp: () => void
}) {
  // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionstatechange_event
  // Event type: generic Event type...
  const onConnectionStateChange = (event: any) => {
    logger(`connectionstatechange: ${event.target?.connectionState}`, event)
    EngineDebugger.addLog({
      label: 'onConnectionStateChange',
      message: 'connectionstatechange',
      metadata: { event, connectionState: event.target?.connectionState },
    })

    switch (event.target?.connnectionState) {
      // From what I understand, only after have we done the ICE song and
      // dance is it safest to connect the video tracks / stream
      case 'connected':
        dispatchEvent(
          // TODO: Mediastream ???? why the fuck is this here. This is a bad dependency flow.
          new CustomEvent(EngineConnectionEvents.NewTrack, {
            detail: { conn: connection, mediaStream: null },
          })
        )
        break
      case 'connecting':
        break
      case 'failed':
        dispatchEvent(new CustomEvent(EngineConnectionEvents.Offline, {}))
        // TODO: Can I do this on the custom event handler...? Why here.
        disconnectAll()
        break
      case 'disconnected':
        dispatchEvent(new CustomEvent(EngineConnectionEvents.Offline, {}))
        // TODO: Can I do this on the custom event handler...? Why here.
        disconnectAll()
        break
      case 'closed':
        cleanUp()
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
}: {
  setMediaStream: (mediaStream: MediaStream) => void
  setWebrtcStatsCollector: (
    webrtcStatsCollector: () => Promise<ClientMetrics>
  ) => void
  peerConnection: RTCPeerConnection
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
    return new Promise(async (resolve, reject) => {
      if (mediaStream.getVideoTracks().length !== 1) {
        reject(new Error('too many video tracks to report'))
        return
      }

      const inboundVideoTrack = mediaStream.getVideoTracks()[0]
      const stats = await peerConnection.getStats()
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
          metrics.rtc_total_freezes_duration_sec = report.totalFreezesDuration
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
  }

  return webrtcStatsCollector
}

export const createOnDataChannel = ({
  setUnreliableDataChannel,
  dispatchEvent,
  trackListener,
  startPingPong,
  connectionManager,
  connectionPromiseResolve,
}: {
  setUnreliableDataChannel: (channel: RTCDataChannel) => void
  dispatchEvent: (event: Event) => boolean
  trackListener: (
    name: string,
    eventListenerTracked: IEventListenerTracked
  ) => void
  startPingPong: () => void
  connectionManager: ConnectionManager
  connectionPromiseResolve: (value: unknown) => void
}) => {
  const onDataChannel = (event: RTCDataChannelEvent) => {
    // Initialize the event.channel with 4 event listeners
    const onDataChannelOpen = createOnDataChannelOpen({
      dispatchEvent,
      startPingPong,
      connectionManager,
      connectionPromiseResolve,
    })
    const onDataChannelError = createOnDataChannelError()
    const onDataChannelMessage = createOnDataChannelMessage()
    const onDataChannelClose = createOnDataChannelClose({
      unreliableDataChannel: event.channel,
      onDataChannelOpen,
      onDataChannelError,
      onDataChannelMessage,
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

    // event.channel is availabe and we initialize listeners on it.
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

    EngineDebugger.addLog({
      label: 'onDataChannelOpen',
      message: 'ondatachannelopen',
      metadata: { event },
    })

    dispatchEvent(
      new CustomEvent(EngineConnectionEvents.Opened, {
        detail: this,
      })
    )
    startPingPong()
    markOnce('code/endInitialEngineConnect')
    connectionPromiseResolve(true)
  }
  return onDataChannelOpen
}

export const createOnDataChannelError = () => {
  const onDataChannelError = (event: Event) => {
    logger('ondatachannelerror', event)
    EngineDebugger.addLog({
      label: 'onDataChannelError',
      message: 'ondatachannelerror',
      metadata: { event },
    })
  }
  return onDataChannelError
}

export const createOnDataChannelMessage = () => {
  const onDataChannelMessage = (event: MessageEvent<any>) => {
    logger('ondatachannelmessage', event)
    EngineDebugger.addLog({
      label: 'onDataChannelMessage',
      message: 'ondatachannelmessage',
      metadata: { event },
    })
    const result: UnreliableResponses = JSON.parse(event.data)
    // TODO: callback? enginecommmand manager in sequence?
  }
  return onDataChannelMessage
}

// TODO: Maybe this is doubled up from the trackListener?
export const createOnDataChannelClose = ({
  unreliableDataChannel,
  onDataChannelOpen,
  onDataChannelError,
  onDataChannelMessage,
}: {
  unreliableDataChannel: RTCDataChannel
  onDataChannelOpen: (event: Event) => void
  onDataChannelError: (event: Event) => void
  onDataChannelMessage: (event: MessageEvent<any>) => void
}) => {
  const onDataChannelClose = () => {
    logger('ondatachannelclose', {})
    unreliableDataChannel.removeEventListener('open', onDataChannelOpen)
    unreliableDataChannel.removeEventListener('error', onDataChannelError)
    unreliableDataChannel.removeEventListener('message', onDataChannelMessage)
  }
  return onDataChannelClose
}
