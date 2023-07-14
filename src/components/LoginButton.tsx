import { invoke } from '@tauri-apps/api/tauri'
import { useStore } from '../useStore'

export const LoginButton = () => {
  const { setToken } = useStore((s) => ({
    setToken: s.setToken,
  }))
  const handleClick = async () => {
    // We want to invoke our command to login via device auth.
    try {
      const token: string = await invoke('login')
      setToken(token)
    } catch (error) {
      console.error("login button", error)
    }
  }
  return <button onClick={() => handleClick()}>Login</button>
}
