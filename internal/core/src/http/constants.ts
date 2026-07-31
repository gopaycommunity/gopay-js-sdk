/**
 * The `Accept` header value the SDK sets on its own API requests.
 * Also reported as the `accept` part of `browser_data.accept_header` on charge
 * requests, so it must stay in sync with every request the SDK sends — both the
 * HTTP client's calls and the auth handler's token requests.
 *
 * Kept in its own module rather than in client.ts because auth-handler.ts needs
 * it too, and client.ts already imports auth-handler.ts — importing it back
 * would introduce a cycle, which `yarn check:circular` fails on in CI.
 */
export const SDK_ACCEPT_HEADER = 'application/json';
