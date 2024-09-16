import { TelemetryExplorer } from '../../TelemetryExplorer'
export const TelemetryPane = () => {
  return (
    <section
      data-testid="telemetry-panel"
      className="absolute inset-0 p-2 box-border overflow-auto"
    >
      <TelemetryExplorer />
    </section>
  )
}
