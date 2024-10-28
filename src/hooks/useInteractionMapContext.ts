import { InteractionMapMachineContext } from 'components/InteractionMapMachineProvider'

export const useInteractionMapContext = () => {
  const interactionMapActor = InteractionMapMachineContext.useActorRef()
  const interactionMapState = InteractionMapMachineContext.useSelector((state) => state)
  return {
    actor: interactionMapActor,
    send: interactionMapActor.send,
    state: interactionMapState,
  }
}
