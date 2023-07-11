import { useStore } from '../useStore'

export const SetToken = () => {
  const { token, setToken } = useStore((s) => ({
    token: s.token,
    setToken: s.setToken,
  }))

  if (!(window as any).__TAURI__) {
    return <div />
  }
  return (
    <div className="w-full flex gap-2">
      token:
      <input
        type="text"
        className="flex-grow font-mono"
        value={token}
        onChange={(e) => {
          setToken(e.target.value)
        }}
        placeholder="<your-token>"
      />
    </div>
  )
}
