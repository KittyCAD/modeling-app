# In-memory project state drives the UI

The in-memory project session and live editor buffers drive the UI; filesystem
and cloud writes are outbound persistence effects. Apply confirmed creation and
rename results to the captured session's latest in-memory state, publishing file
membership and editor-source changes together, rather than rereading storage to
rediscover changes the application just performed. Read storage for project and
file loading and for reconciliation with external changes, reconnects, and
conflicts, preserving unsaved work and rejecting results for closed or replaced
project openings.
