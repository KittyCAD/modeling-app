import { useEffect, useState } from 'react'

const Loading = () => {
  const [hasLongLoadTime, setHasLongLoadTime] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      setHasLongLoadTime(true)
    }, 4000)

    return () => clearTimeout(timer)
  }, [setHasLongLoadTime])
  return (
    <div className="body-bg flex flex-col items-center justify-center h-screen">
      <svg viewBox="0 0 10 10" className="w-8 h-8">
        <circle cx="5" cy="5" r="4" stroke="var(--liquid-20)" fill="none" />
        <circle
          cx="5"
          cy="5"
          r="4"
          stroke="var(--liquid-10)"
          fill="none"
          strokeDasharray="4, 4"
          className="animate-spin origin-center"
        />
      </svg>
      <p className="mt-4 text-liquid-80 dark:text-liquid-20">
        Loading KittyCAD Modeling App...
      </p>
      <p
        className={
          'mt-4 text-liquid-90 dark:text-liquid-10 transition-opacity duration-500' +
          (hasLongLoadTime ? ' opacity-100' : ' opacity-0')
        }
      >
        Loading is taking longer than expected.
      </p>
    </div>
  )
}

export default Loading
