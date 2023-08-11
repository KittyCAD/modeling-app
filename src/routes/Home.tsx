import { useEffect, useRef } from 'react'
import { useStore } from '../useStore'

const Home = () => {
  const { defaultDir, setDefaultDir } = useStore((s) => ({
    defaultDir: s.defaultDir,
    setDefaultDir: s.setDefaultDir,
  }))
  const files = useRef<string[]>([])

  useEffect(() => {}, [defaultDir])

  return (
    <div className="my-24 max-w-5xl mx-auto">
      <h1 className="text-3xl text-bold">Home</h1>
      {files.current.length > 0 && (
        <ul>
          {files.current.map((file) => (
            <li>{file}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default Home
