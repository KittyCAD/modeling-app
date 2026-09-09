import { useZookeeperConversationScroll } from '@src/lib/zookeeper/components/useZookeeperConversationScroll'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'

// A browser layout fixture for the production scroll hook. No engine, account,
// or live Zookeeper request is needed to exercise viewport geometry.
function ScrollFixture() {
  const [prompts, setPrompts] = useState<number[]>([])
  const [responseHeight, setResponseHeight] = useState(0)
  const [height, setHeight] = useState(600)
  const [scopeKey, setScopeKey] = useState('first')
  const [visible, setVisible] = useState(true)
  const [error, setError] = useState(false)
  const scroll = useZookeeperConversationScroll({
    scopeKey,
    promptIndex: prompts.length - 1,
    visible,
  })
  const submit = () => {
    setPrompts([...prompts, responseHeight])
    setResponseHeight(0)
    setError(false)
  }

  return (
    <>
      <button onClick={submit}>Submit</button>
      <button onClick={() => setResponseHeight(180)}>Reason</button>
      <button onClick={() => setResponseHeight(120)}>Complete</button>
      <button onClick={() => setResponseHeight(responseHeight + 800)}>
        Grow
      </button>
      <button onClick={() => setHeight(height === 600 ? 400 : 600)}>
        Resize
      </button>
      <button onClick={() => setVisible(!visible)}>Reconnect</button>
      <button onClick={() => setError(true)}>Error</button>
      <button
        onClick={() => {
          setScopeKey(scopeKey === 'first' ? 'second' : 'first')
          setPrompts([800, 800])
          setResponseHeight(800)
        }}
      >
        Load history
      </button>
      <button
        onClick={() => {
          setPrompts([])
          setResponseHeight(0)
        }}
      >
        Clear
      </button>
      <div
        ref={scroll.scrollRef}
        data-testid="transcript"
        style={{ height, width: 380, overflow: 'auto', overflowAnchor: 'none' }}
      >
        <div
          ref={scroll.contentRef}
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          {visible &&
            prompts.map((_, index) => (
              <div key={index}>
                <div style={{ height: 72 }}>Timestamp</div>
                <div
                  ref={
                    index === prompts.length - 1 ? scroll.promptRef : undefined
                  }
                  data-testid="prompt"
                  style={{ height: 48, background: '#cde' }}
                >
                  Prompt {index + 1}
                </div>
                <div
                  data-testid="response"
                  style={{
                    height:
                      index === prompts.length - 1
                        ? responseHeight
                        : prompts[index + 1],
                  }}
                >
                  {index === prompts.length - 1 && responseHeight > 0 && (
                    <div
                      data-testid="reasoning"
                      style={{ height: 100, overflow: 'auto' }}
                    >
                      <div style={{ height: 600 }}>Reasoning</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          {visible && error && <div style={{ height: 60 }}>Request failed</div>}
        </div>
        <div ref={scroll.spacerRef} data-testid="spacer" aria-hidden="true" />
      </div>
    </>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<ScrollFixture />)
