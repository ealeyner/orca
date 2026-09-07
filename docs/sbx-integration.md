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

With structured native chat enabled, local Claude and Codex tabs create a sandbox
and use the guest provider protocol. Existing host sessions cannot launch while
sandbox execution is enabled. Unsupported launch configurations remain terminal-backed.

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

Docker's agent authentication remains inside the sandbox. Native chat uses the
pinned guest account root; it does not forward host account credentials.
Host hooks and host-local transcript discovery are not bridged into the guest.
This integration does not offer administrator-enforced restrictions on the Orca
user themselves: sandbox creation defaults can be changed by that user. Use Docker
governance profiles for centrally enforced policy.

### Native provider work still required

Durable sandbox identity, guest-aware recovery, account-root provisioning, and native
Claude/Codex acquisition are connected to local IDE creation. Remaining work:

- Guest transcript access for terminal/native continuity.
- Native/terminal handoff within the same guest (currently refused).
- Broader native UI coverage of approvals, cancellation, resume, and crash recovery.
- Live remote and Windows verification.

The Codex guest transport is now implemented in `sbx-codex-connection.ts` and
verified against a real Docker sandbox: initialization, model discovery, and
confirmed guest shutdown passed. Its exit callback cannot release ownership on
local transport exit alone; failed handshake cleanup retains a retryable connection.
Codex native acquisition now selects this transport for sandbox records and passes
the account root inside the guest. Resume uses the guest provider thread ID without
consulting host rollout files or credentials. Guest history paths are not exposed
as host-local files; guest transcript access and TUI handoff still need integration.

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

Sandbox session records use schema version 3 and pin the Docker sandbox ID and name
in their execution location. Host records remain version 2. Readers that predate
sandbox records quarantine version 3 instead of resuming it on the host. Scope keys
separate host workspaces and each immutable guest ID. Store reopen tests cover this
identity. Sandbox owner probes require transport-exit proof followed by inventory proof that
the pinned guest ID is stopped or absent. A running guest, a failed inventory read,
or another execution host stays fenced. Batch recovery uses the same checks. Guest
transcript resolution still needs work; native IDE creation is connected.

`sbx-codex-acquisition.live.test.ts` exercises native acquisition, submission, close,
and resume in a disposable guest. Set the same opt-in variables plus
`ORCA_SBX_CODEX_HOME` to the guest account directory. It submits a minimal prompt;
it requires confirmed cancellation before resuming the same thread. Sandbox
cancellation stops the entire per-agent guest and enters session recovery, rather
than treating host process enumeration as proof that guest tools exited.
An empty Codex thread is not persisted until its first turn.

Claude native acquisition now routes sandbox records through the guest SDK, pins
`CLAUDE_CONFIG_DIR` in the guest, and keeps host transcript readers out of guest
session settlement. Failed SDK startup retains retryable cleanup until exit is
proved. Resolver/acquisition regression tests and live idle acquisition now pass. Claude's
initialization response supplies a guest PID; Orca reads only that PID's startup
record under the pinned guest account and verifies session ID, workspace, process
start time, PID namespace, and sandbox identity. This handles template Claude Code
2.1.246 without requiring a SessionStart/system-init frame before the first prompt.
Missing or stale records do not prove a session, and a closed connection cannot
start a late metadata probe. The bounded reader runs inside the guest with no host
transcript or credential access.

Repeat `sbx-claude-acquisition.live.test.ts` with `ORCA_SBX_NATIVE_SMOKE=1`,
`ORCA_SBX_CLAUDE_SMOKE_NAME`, and `ORCA_SBX_CLAUDE_CONFIG_DIR` set for a stopped,
disposable guest. The test proves the requested session identity and shutdown;
Claude turn submission, cancellation, shutdown, and branch-preserving resume also
pass in this live check. Claude-specific native IDE coverage still needs expansion.

Native creation preparation now reuses `ensureSbxAgentSandbox` and each agent's
launch policy. It discovers the account root inside the guest, proves inspection
shutdown, and persists the account pin alongside the immutable binding. Retries
reuse a live pinned guest without stopping it, and a deleted pinned guest is not
silently recreated. Unproven inspection cleanup remains retryable. The runtime's
create-intent resolver consumes this prepared identity without touching host
accounts. Native-chat availability requires the sandbox runtime capability.
`sbx-native-session-preparation.live.test.ts` (`ORCA_SBX_PREPARATION_SMOKE=1`) covers
real provisioning, account pinning, retries, deletion, and refusal to recreate.

### Native IDE verification

`sbx-native-chat.spec.ts` runs a hidden Electron app through the real desktop IPC,
provisioning, pinned records, sbx transport, and native journal/rendering path. A
scripted Codex app-server supplies a deterministic reply, and the test verifies the
managed guest appears in Settings. This complements the separate live guest tests;
it does not establish Docker VM isolation by itself.

Both desktop IPC calls and subscriptions advertise `agent-session.structured.sandbox.v1`.
Older paired clients cannot create or attach sandbox native sessions. Before every
provider acquisition, record-scoped policy verifies the immutable guest/account
binding and agent permission. Disabling global sandbox defaults never converts an
existing guest session into a host session.

Sandbox-backed terminal tabs open in terminal view even when chat is the default.
This also applies to definitive native-creation fallbacks, so the composer does not
appear without access to the guest transcript. Native structured chat still uses
the normal chat view when supported.

A live probe on the validated sbx build showed that `sbx cp` from a stopped guest
starts that guest, just like `sbx exec`. Guest transcript collection must therefore
hold execution ownership and prove shutdown after any stopped-guest inspection;
copying alone is not a passive read. The disposable probe guest was removed.

`sbx-stopped-inspection.ts` shares native-provider reservations for guest inspection.
It rejects overlapping reads, withholds results until shutdown proof succeeds, and
retains unsuccessful cleanup for retry before another inspection or preparation.
Native account-root preparation uses this path. Guest transcript acquisition can
reuse it without treating stopped-guest filesystem access as passive.

`withSbxTranscriptSnapshot` now supplies a private temporary host JSONL snapshot
from a known path under the pinned guest account. Reads use 256 KiB chunks, verify
file identity/version across chunks and immutable sandbox identity around each
command, and reject symlinks escaping the account root. The consumer runs only
after stopped-state proof, and temporary files are removed afterward. Individual
snapshots are limited to 128 MiB. The live preparation test covers a multi-megabyte
snapshot and checks the guest is stopped before consumption. Provider transcript
path discovery and handoff consumers still need to be connected to this reader.
