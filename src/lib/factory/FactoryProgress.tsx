export type FactoryFormStep = 'files' | 'parts' | 'shipping' | 'review'

const steps: { id: FactoryFormStep; title: string }[] = [
  { id: 'files', title: 'Choose parts' },
  { id: 'parts', title: 'Job details' },
  { id: 'shipping', title: 'Delivery' },
  { id: 'review', title: 'Confirm jobs' },
]

export function FactoryProgress({ step }: { step: FactoryFormStep }) {
  const current = steps.findIndex((item) => item.id === step)
  return (
    <div className="space-y-4">
      <nav aria-label="Factory submission progress">
        <ol className="flex items-center">
          {steps.map((item, index) => (
            <li
              key={item.id}
              aria-current={item.id === step ? 'step' : undefined}
              aria-label={`Step ${index + 1}: ${item.title}`}
              className="flex flex-1 items-center last:flex-none"
            >
              <span
                aria-hidden="true"
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm font-semibold ${index === current ? 'border-primary bg-primary text-white ring-4 ring-primary/10' : index < current ? 'border-primary/40 bg-primary/10 text-primary' : 'b-4 bg-1 text-3'}`}
              >
                {index + 1}
              </span>
              {index < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`mx-2 h-0.5 flex-1 rounded-full ${index < current ? 'bg-primary/50' : 'bg-3/50'}`}
                />
              )}
            </li>
          ))}
        </ol>
      </nav>
      <h3 className="text-base font-semibold text-1">{steps[current].title}</h3>
    </div>
  )
}
