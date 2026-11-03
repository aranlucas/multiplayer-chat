# Cloudflare integration decisions

## Observability without a second instrumentation stack

Relay enables Workers Issues and sampled traces in
[cloudflare.config.ts](../cloudflare.config.ts). Platform instrumentation avoids
another SDK for Worker-to-room RPC diagnostics. Query strings are redacted;
sampling limits trace volume. Detection is enabled in configuration, while
account-level automations remain a separate operational choice.

Optional AI Gateway routing preserves the selected OpenRouter model and provider
credentials. It skips response caching, logs usage metadata and excludes prompt
and response bodies by default. Payload logging is an explicit opt-in because
room code and prompts can be sensitive. Traffic is tagged for Relay as a whole;
participant-level spend attribution is not implemented. See the
[setup instructions](../README.md#run-locally) for configuration.

## Preview handoff versus isolated testing

Published previews intentionally reconnect to the existing control-plane room:
participants, event history and unsent drafts must survive a UI revision.
An isolated full-stack test environment serves a different need and must not
replace that handoff contract. See [publication setup](../README.md#deploy).

## Migration candidates

These are separate design investigations, not committed releases; the ordered
product priorities are in [ROADMAP.md](../ROADMAP.md).

- **Cloudflare-native sandboxes:** a replacement for Railway must cover its
  command/session recovery and file APIs, then prove persistence and concurrent
  publication behavior through a provider adapter before switching backends.
- **Versioned workspace storage:** replacing the current Git workspace requires
  explicit retention, authentication, merge and recovery semantics while
  preserving exact-revision publication.
- **Disconnected agent work:** evaluate runtime keep-alive behavior with deployed
  disconnect/reconnect tests before changing the compatibility configuration.
- **Automatic model routing:** evaluate coding tasks and tool calls first;
  changing the selected model also changes cost and model-selection semantics.
- **Credential and abuse controls:** review actual deployment/preview permissions
  and define participation behavior before adding narrower credentials or bot
  verification to public live rooms.

SQLite Durable Objects already provide ordered room events and persistence.
Additional stores need a concrete workload that justifies the coordination and
consistency cost.
