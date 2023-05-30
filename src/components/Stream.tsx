import { useEffect, useRef } from 'react'
import { PanelHeader } from '../components/PanelHeader'

export const Stream = () => {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof RTCPeerConnection === 'undefined'
    )
      return
    const url = 'wss://fleet.j3ss.co/ws/modeling/commands'
    const [pc, socket] = [new RTCPeerConnection(), new WebSocket(url)]
    // Connection opened
    socket.addEventListener('open', (event) => {
      console.log('Connected to websocket, waiting for ICE servers')
    })

    socket.addEventListener('close', (event) => {
      console.log('websocket connection closed')
    })

    socket.addEventListener('error', (event) => {
      console.log('websocket connection error')
    })

    // Listen for messages
    socket.addEventListener('message', (event) => {
      //console.log('Message from server ', event.data);
      if (event.data instanceof Blob) {
        const reader = new FileReader()

        reader.onload = () => {
          //console.log("Result: " + reader.result);
        }

        reader.readAsText(event.data)
      } else {
        console.log(event.data)
        const message = JSON.parse(event.data)
        if (message.type === 'SDPAnswer') {
          pc.setRemoteDescription(new RTCSessionDescription(message.answer))
        } else if (message.type === 'IceServerInfo') {
          console.log('received IceServerInfo')
          pc.setConfiguration({
            iceServers: message.ice_servers,
          })
          pc.ontrack = function (event) {
            if (videoRef.current) {
              videoRef.current.srcObject = event.streams[0]
              videoRef.current.autoplay = true
              videoRef.current.muted = true
              videoRef.current.controls = false
            }
          }
          pc.oniceconnectionstatechange = (e) =>
            console.log(pc.iceConnectionState)
          pc.onicecandidate = (event) => {
            if (event.candidate === null) {
              console.log('sent SDPOffer')
              socket.send(
                JSON.stringify({
                  type: 'SDPOffer',
                  offer: pc.localDescription,
                })
              )
            }
          }

          // Offer to receive 1 video track
          pc.addTransceiver('video', {
            direction: 'sendrecv',
          })
          pc.createOffer()
            .then((d) => pc.setLocalDescription(d))
            .catch(console.log)
        }
      }
    })

    const debounceSocketSend = throttle((message) => {
      console.log(JSON.stringify(message))
      socket.send(JSON.stringify(message))
    }, 100)
    const handleMouseMove = ({ clientX, clientY }: MouseEvent) => {
      if (!videoRef.current) return
      const { left, top } = videoRef.current.getBoundingClientRect()
      const x = clientX - left
      const y = clientY - top
      debounceSocketSend({
        cmd: {
          AddLine: {
            from: { x: 0.0, y: 0.0, z: 0.0 },
            to: { x: 1.0, y: 1.0, z: 1.0 },
          },
        },
        cmd_id: '41940db0-a101-4ca9-a8ba-d576dabf5ee3',
        file_id: '',
      })
      console.log('mouse move', x, y)
    }
    if (videoRef.current) {
      videoRef.current.addEventListener('mousemove', handleMouseMove)
    }

    return () => {
      socket.close()
      pc.close()
      if (!videoRef.current) return
      videoRef.current.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  return (
    <div>
      <PanelHeader title="Stream" />
      <video ref={videoRef} />
    </div>
  )
}

function throttle(
  func: (...args: any[]) => any,
  wait: number
): (...args: any[]) => any {
  let timeout: ReturnType<typeof setTimeout> | null
  let latestArgs: any[]
  let latestTimestamp: number

  function later() {
    timeout = null
    func(...latestArgs)
  }

  function throttled(...args: any[]) {
    const currentTimestamp = Date.now()
    latestArgs = args

    if (!latestTimestamp || currentTimestamp - latestTimestamp >= wait) {
      latestTimestamp = currentTimestamp
      func(...latestArgs)
    } else if (!timeout) {
      timeout = setTimeout(later, wait - (currentTimestamp - latestTimestamp))
    }
  }

  return throttled
}
