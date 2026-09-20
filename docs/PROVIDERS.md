# Providers

A **provider** supplies a capability (text completion/translation today; more can be added). Providers are
local or external (cloud). External providers are **opt-in**: nothing leaves the machine unless you enable
external processing in **Settings → Privacy**, and every request is gated and logged.

## Built-in text providers

| id | Kind | Needs key | Capability |
|---|---|---|---|
| `anthropic` | cloud | yes | `llm.text`, `translate` |
| `openai-compatible` | cloud | yes | `llm.text`, `translate` (any OpenAI-compatible endpoint) |
| `ollama` | local service | no | `llm.text`, `translate` (local `http://127.0.0.1:11434`) |

Configure them in **Settings → External Providers**: enable, set base URL and model, and (for cloud) an
API key. **Test** does a real round-trip. Keys are stored with the OS keychain when available (Electron
`safeStorage`: macOS Keychain, Windows DPAPI, Linux libsecret) and are **never** returned to the
interface — the status only reports `hasSecret` and whether it is encrypted.

Configuring any text provider makes the assistant's `llm.text` and subtitle **translation** capabilities
available. The deterministic assistant works with no provider at all; a text model only widens
understanding and never bypasses the zod schema or the per-operation verification.

## How requests are protected

Every provider call goes through `NetworkGateway.fetchJson`:

- refused unless external processing is enabled in Privacy,
- HTTPS only (localhost is allowed for Ollama),
- logged to the network log (host, purpose, bytes) shown in Diagnostics.

## Adding a new provider

The provider layer lives in `packages/engine/src/providers`.

1. **Descriptor** — add an entry to `PROVIDER_DESCRIPTORS` in `descriptors.ts`:
   `{ id, name, kind, external, needsSecret, defaultBaseUrl, defaultModel, capabilities, docsUrl }`.
2. **Request shape** — if it is not Anthropic-, OpenAI- or Ollama-shaped, add a branch in
   `completeText()` (`textProviders.ts`) that builds the request and extracts the text, calling
   `gateway.fetchJson` with `purpose: \`provider:${id}\``.
3. **Capability** — text providers automatically feed `llm.text`/`translate` via `ProvidersService`. For a
   new capability kind, register it in `ProvidersService.registerCapabilities()` with an honest gate
   (available only when a provider is configured).
4. **Config UI** — the **External Providers** screen renders every descriptor generically (base URL,
   model, key when `needsSecret`), so a new descriptor needs no UI work unless it has unusual fields.
5. **Test** — add a `providers.test`-covered mock server case in `providers.test.ts` (there is a local
   OpenAI-compatible mock to copy).

Secrets must never be logged or returned to the renderer; always resolve them through
`ProvidersService` (which decrypts via the host keychain at call time only).
