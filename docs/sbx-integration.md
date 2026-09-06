# Docker Sandboxes integration

Open **Docker Sandboxes** from the sidebar toolbar, or Settings → Agents. Enable
**Start agents in Docker Sandboxes** to route new agent terminals through `sbx`.
Existing host terminals are not migrated or terminated by this setting.

Each agent pane receives a distinct sandbox. Provisioning finishes before its
agent command is delivered. A failed or unsupported launch raises an error; it
does not run the agent on the host. The normal workspace mount keeps the editor,
Git changes, and agent files in the same workspace, including folder projects.

## Agent access

**Agent access defaults** controls whether an agent may start, its template,
CPU/memory limits, extra workspace mounts (read-only by default), network deny
rules, fixed MCP servers, and governance profile. These defaults apply at creation.
Existing sandbox permissions remain visible in **Access & ports**. Docker enforces
policy; organization rules cannot be overridden by local allow rules.

Built-in Docker agent templates use `sbx run`. Other Orca agents require a template
containing their Linux CLI and run through `sbx exec`. Custom host shell wrappers
are refused. Authentication belongs to Docker Sandboxes; Orca does not mount its
host account directories or inject its host control-plane tokens into the guest.

The IDE can list, create, start, stop, remove, attach to an agent, and open a guest
shell. Removal requires confirmation. Network changes are always sandbox-scoped.
The details view includes policy inspection, access checks, recent access decisions,
MCP loading, and port publishing/unpublishing. Port specifications follow sbx's
`[[HOST_IP:]HOST_PORT:]SANDBOX_PORT[/PROTOCOL]` syntax and default to loopback.

## Execution hosts and recovery

The selected runtime owns the operation. SSH targets execute sbx using Orca's
existing authenticated relay. No remote operation falls back locally. An unreachable
host is unverifiable, not stopped. SSH terminals require the corresponding workspace
to be open on that host. WSL-wrapped launches are refused; select the native runtime
for Docker Sandboxes.

Agent sandbox names derive from stable pane identity. A private, atomic binding
records the immutable sandbox ID and owning host. A same-name replacement is never
silently adopted. Concurrent creation for one pane is coalesced. Agent sandboxes
remain available after terminal closure and can be removed explicitly from the IDE.

Structured native chat is refused when sandbox execution is enabled, so it cannot
bypass the terminal execution boundary. New agent tabs use their terminal interface.

`ORCA_SBX_BINARY` optionally selects an alternate local sbx executable. SSH operations
resolve `sbx` on the remote host; a client executable path is never sent remotely.

## Verification

- `pnpm tc`
- `ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run --config config/vitest.config.ts src/main/sbx src/main/runtime/rpc/methods/sbx.test.ts`
- Build with `pnpm exec electron-vite build --mode e2e`, then run the hidden
  `settings-sbx.spec.ts` and `sbx-agent-launch.spec.ts` Electron tests.

The launch fixture exercises the real renderer, IPC, runtime, process runner, and
terminal path with a deterministic substitute for the external sbx executable. It
does not establish Docker VM isolation; that requires a live Docker Sandboxes smoke
test. The settings test exercises native persistence and captures the rendered UI.

## Tested runtime and limits

Validated against sbx `v0.38.0-rc1-39-g45cfc5b56` on macOS. Live checks covered a
shell sandbox, reading/writing its mounted workspace, a denied network host,
loopback HTTP port publishing, stop, and removal. Disposable test sandboxes were
removed afterward. Docker requires the primary workspace to be read/write; only
additional mounts accept read-only mode.

The shell/agent attachment flow resolves the sandbox on its owning runtime, then
creates the tab through the calling client's normal terminal flow. It never asks
a remote host to focus its desktop window. Open the corresponding workspace in
Orca before attaching. Remote host routing and loss-of-contact behavior have unit
coverage; a live SSH/Windows Docker installation has not been exercised.

Docker's native agent authentication and TUI remain inside the sandbox. Orca's
host-only structured chat providers are disabled while sandbox mode is enabled.
Host hooks and host-local transcript discovery are not bridged into the guest.
This integration does not offer administrator-enforced restrictions on the Orca
user themselves: sandbox creation defaults can be changed by that user. Use Docker
governance profiles for centrally enforced policy.

### Native provider work still required

Structured providers need a durable sandbox execution namespace, not only an
`sbx exec` command prefix. Their current owner probes observe host PIDs, and their
resume resolvers read host account roots. Before enabling native structured chat:

- Pin the immutable sandbox ID and guest account root in each durable session.
- Resolve provider handles and transcript proofs inside that pinned sandbox.
- Wire the verified Codex and Claude guest connections into durable session
  acquisition without PTY or startup banners.
- Distinguish a lost sbx transport from proven guest process exit during close,
  crash recovery, and native/TUI handoff. `sbx-lifecycle.ts` supplies identity checks
  and post-operation sandbox state verification for that boundary.
- Reuse `sbx-agent-sandbox.ts` for provisioning rather than creating a separate
  sandbox ownership scheme for native sessions.
- Exercise approvals, cancellation, resume, and crash recovery through native UI
  tests and live guest processes before removing the host-provider launch guard.


The Codex guest transport is now implemented in `sbx-codex-connection.ts` and
verified against a real Docker sandbox: initialization, model discovery, and
confirmed guest shutdown passed. Its exit callback cannot release ownership on
local transport exit alone; failed handshake cleanup retains a retryable connection.
The adapter is not yet connected to native session acquisition, because the durable
record and restart-time owner probes must first understand sandbox identity.

To repeat the opt-in transport check, create and stop a disposable Codex sandbox,
then set `ORCA_SBX_NATIVE_SMOKE=1` and `ORCA_SBX_NATIVE_SMOKE_NAME` to its name while
running `src/main/sbx/sbx-codex-connection.live.test.ts` with Vitest. The test stops
but does not remove that sandbox. Normal test runs skip the live check.


The Claude SDK guest transport is implemented in `sbx-claude-connection.ts` and
verified with a live sandbox through SDK initialization, model discovery, and
shutdown. It preserves SDK permission callbacks, does not hold the host-account
refresh gate, and retains retryable cleanup after partially spawned SDK failures.
Both providers share generation-scoped sandbox reservations so delayed cleanup
cannot stop or release a later connection. The guest-exit proof is shared by the
native provider connections; local process exit alone never proves guest exit.

For the Claude opt-in check, use a stopped disposable Claude sandbox and set
`ORCA_SBX_NATIVE_SMOKE=1` and `ORCA_SBX_CLAUDE_SMOKE_NAME`, then run
`src/main/sbx/sbx-claude-connection.live.test.ts`. As with the Codex check, the test
stops the sandbox and leaves explicit removal to the caller.
