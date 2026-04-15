import type { PropsWithChildren, ReactNode } from 'react'
import { CustomIcon } from './CustomIcon'

/**
 * Local authoring surface for the MlEphant welcome message.
 *
 * When this content needs to come from a remote source, resolve that content
 * before rendering `MlEphantConversation` and pass it through the
 * `welcomeMessage` prop. That keeps the conversation layout logic unchanged
 * while swapping the content source.
 */
export const MlEphantConversationWelcome = () => {
  return (
    <div data-testid="ml-ephant-conversation-welcome" className="px-4 py-3">
      <div className="bg-img-mel w-16 h-16" />
      <h2 className="text-xl font-bold">Hello there, I’m Zookeeper.</h2>
      <p>
        I'm here to help you create and edit real, parametric CAD geometry
        through incremental, structured commands.
      </p>

      <WelcomeItem
        graphic={
          <video
            className="w-12 h-12 object-cover object-center"
            muted
            autoPlay
            loop
          >
            <source src="/mlephant-idle-1.wemb" />
          </video>
        }
        heading="Ask me anything"
      >
        <p>
          From designing parts to giving manufacturing feedback, I’m ready to
          help.
        </p>
      </WelcomeItem>
      <WelcomeItem
        graphic={
          <video
            className="w-12 h-12 object-cover object-center"
            muted
            autoPlay
            loop
          >
            <source src="/mlephant-idle-1.wemb" />
          </video>
        }
        heading="Turn thoughts into geometry"
      >
        <p>
          I create structured, fully editable geometry by building features step
          by step.
        </p>
      </WelcomeItem>
      <WelcomeItem
        graphic={
          <video
            className="w-12 h-12 object-cover object-center"
            muted
            autoPlay
            loop
          >
            <source src="/mlephant-idle-1.wemb" />
          </video>
        }
        heading="Supplemental analysis"
      >
        <p>
          Beyond geometry creation, I can help you with model-derived properties
          like center of mass, volume, and surface area.
        </p>
      </WelcomeItem>
      <WelcomeItem
        graphic={
          <CustomIcon name="paperclip" className="w-8 h-8 m-2 flex-none" />
        }
        heading="Upload your image to work from real references"
      >
        <p>
          Upload an image and I’ll interpret it, extract intent, and help you
          design or improve the geometry step by step.
        </p>
      </WelcomeItem>
    </div>
  )
}

interface WelcomeItemProps extends PropsWithChildren {
  graphic: ReactNode
  heading: string
}

function WelcomeItem(props: WelcomeItemProps) {
  return (
    <div className="flex gap-4">
      {props.graphic}
      <div>
        <h2 className="font-bold text-base">{props.heading}</h2>
        <div className="text-3 text-sm">{props.children}</div>
      </div>
    </div>
  )
}
