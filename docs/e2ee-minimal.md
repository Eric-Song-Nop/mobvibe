# Mobvibe Minimal E2EE (TOFU + Multi-Client)

> **Note:** This document was the initial design proposal. The actual implementation
> uses a simpler DEK-per-session approach (`crypto_box_seal` + `crypto_secretbox`)
> with static keys derived from a master secret, rather than the per-connection
> `crypto_kx` + `crypto_secretstream` channel model described below.
>
> The crypto library has been migrated from `libsodium-wrappers` (WASM) to
> `tweetnacl` + `@noble/hashes` (pure JS) for better cross-platform compatibility.
>
> See [`docs/e2ee-implementation.md`](./e2ee-implementation.md) for the implemented design.

## Goal

Provide end-to-end encryption with minimal product impact and low development/maintenance cost.

Requirements:

- User experience should be mostly invisible in normal use.
- Support one CLI machine with multiple WebUI tabs/instances and optional Tauri mobile clients at the same time.
- Gateway remains untrusted for content.

## Topology

Current topology stays unchanged:

- `CLI <-> Gateway`: one physical Socket connection per machine (`machineId`)
- `Gateway <-> WebUI/Tauri`: multiple client Socket connections

E2EE is implemented as logical encrypted channels on top of this transport.

## Is This Still E2EE?

Yes.

A deployment is considered E2EE when all of these hold:

1. Plaintext exists only at endpoints (CLI and each WebUI/Tauri client).
2. Gateway can route messages but cannot decrypt content.
3. Any ciphertext tampering is detected by endpoints.

Physical network shape (`1 CLI -> 1 Gateway -> N clients`) does not break E2EE by itself.

## Trust Model

- Use TOFU (Trust On First Use).
- On first successful secure connection, client pins CLI identity public key fingerprint.
- On later connections, mismatch means block secure session and show warning.

Accepted TOFU limitation:

- First-connection MITM cannot be fully prevented without out-of-band verification.

## Minimal Crypto Choice

Use high-level libsodium APIs:

- Key exchange: `crypto_kx`
- Data channel encryption: `crypto_secretstream_xchacha20poly1305`

Why this choice:

- Simple APIs with less nonce/state misuse risk.
- Works across browser + Node/Bun with `libsodium-wrappers`.
- Lower implementation and maintenance complexity than Signal/Matrix/MLS stacks.

## Channel Model (Multi-Client)

Each active client connection gets an independent logical channel:

- `channelId`: unique per live client connection (tab/app process/reconnect)
- Per-channel state on CLI: handshake state + secretstream `tx/rx` state

Example:

- 1 CLI + 3 browser tabs + 1 mobile app = 4 concurrent channels

Broadcast behavior:

- For one outbound logical event, CLI encrypts once per active channel and fan-outs ciphertexts.
- Cost is linear with active clients, which is acceptable for small N and keeps design simple.

## Reconnect Rules

- Channel state is not reused after reconnect.
- Client reconnect creates a new `channelId` and performs handshake again.
- Old channel state expires quickly (TTL cleanup on CLI).

This avoids stream-state corruption and replay/nonce hazards across reconnects.

## Plaintext vs Ciphertext Boundary

Keep only routing metadata in plaintext:

- `sessionId`, `machineId`, event kind, sequence/revision, timestamps, `channelId`

Encrypt all content-bearing fields:

- `session:event.payload`
- `rpc:message:send.params.prompt`
- `rpc:session:events.events[].payload`

## Anti-Downgrade Policy

Hosted mode policy:

- If E2EE is required and secure channel is not established, block send/receive of protected content.
- No silent fallback to plaintext.

## Non-Goals (v1)

To keep implementation and maintenance cost low, v1 intentionally excludes:

- Double Ratchet
- Group key protocols (MLS/Megolm)
- Complex multi-device trust ceremonies
- Full encryption of all RPC fields on day one

## Operational Notes

- Gateway can still observe metadata (who/when/how much), but not message content.
- Local CLI storage is out of E2EE scope unless separately encrypted at rest.
- Key rotation can be added later; not required for minimal v1 launch.

## Implementation Checklist (Minimal)

1. Add identity key generation/load for CLI and fingerprint pinning on client.
2. Add handshake messages for per-channel key setup.
3. Encrypt/decrypt only the three highest-value content fields listed above.
4. Enforce fail-closed behavior when E2EE is required.
5. Add basic tests: tamper detect, reconnect re-handshake, multi-client concurrent channels.
