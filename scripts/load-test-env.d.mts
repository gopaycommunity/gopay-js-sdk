/**
 * Types for `load-test-env.mjs`.
 *
 * The helper stays plain ESM so both `sdk/vitest.config.ts` and
 * `browser-sdk/vitest.e2e.config.ts` can import it without a build step - a `.ts` helper
 * would have to be compiled before either config could load it. This declaration is what
 * lets those configs import it with real types instead of a `@ts-expect-error`.
 */

/**
 * Reads `.env` and merges it with the real environment, which wins.
 *
 * @param path - `.env` to read; absent is fine, CI supplies the values directly.
 * @param requiredKeys - keys without which the suites cannot authenticate; a missing one
 *   throws rather than letting the suite start and fail on a token call.
 */
export declare function loadTestEnv(
    path: string,
    requiredKeys: readonly string[],
): Record<string, string>;
