import { AppMachineContext } from 'machines/appMachine'
import { PropsWithChildren } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export const AppMachineProvider = ({ children }: PropsWithChildren) => {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <AppMachineContext.Provider
      options={{
        input: {
          navigate,
          location,
        },
      }}
    >
      {children}
    </AppMachineContext.Provider>
  )
}
