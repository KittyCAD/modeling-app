# Community contributions and authority are independent

Community plugins must be able to contribute tools, layout areas, executors, and
editor modes without implicitly obtaining access to design data or authority to
change it. Registering a contribution grants no data access or privileged action;
trusted host adapters mediate operations using separately declared and granted
permissions, so adding a contribution point cannot silently broaden a plugin's
authority.

An installation inherently owns its ordinary settings namespace. Declaring fields
describes values within that existing authority; it grants no access to application
settings, other installations, design data, or permission grants. Settings values
must remain separate from permission approvals, even when a plugin presents a
setting with a name resembling a privileged capability.

Bind resource authority to explicit host-issued handles, such as one document in
one project opening or one model view and execution. Selecting another project or
view must never redirect an existing handle to the newly active resource. An
operation must reject a handle that has been revoked or whose resource lifetime
has ended; execution-bound authority must also reject a superseded execution.

Keep community code in a runtime without ambient browser, filesystem, network, or
application-service access. A restricted SDK in the application's own JavaScript
realm would leave independent routes to those capabilities. Any future network
access must therefore be an explicit host operation checked against a scoped
grant, including redirect destinations and the authority of the requesting
installation.

The prototype demonstrates this boundary with QuickJS and a notification grant.
Scoped resource handles and a network broker remain unimplemented. Installation
identity, activation preference, and permission grants are distinct concepts;
starting an installed plugin must not itself approve additional authority.
