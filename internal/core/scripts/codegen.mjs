#!/usr/bin/env node
// Regenerate src/types/generated.ts from the "next spec" — the upcoming version of the GoPay
// Payments API spec, ahead of what api-docs.gopay.com publishes.
//
// Run: SPEC_SOURCE='<url-or-path>' yarn codegen
//
// SPEC_SOURCE is required and may be a URL or a local file path. The two supported ways to
// obtain the next spec — GoPay's internal pre-release feed, or a sideload from a commit of
// the API spec repo — are documented in CLAUDE.md. The source is deliberately not hardcoded
// here; see CLAUDE.md for why.
//
// Both outputs — Payments.yaml at the repo root and src/types/generated.ts — are staged to
// temporary files and moved into place only once type generation succeeds, so a failed run
// never leaves one refreshed and the other stale.

import { spawnSync } from 'node:child_process';
import {
    existsSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = resolve(HERE, '../../../Payments.yaml');
// Anchored to this file, not to cwd — otherwise running codegen from the repo root writes the
// snapshot (absolute) correctly but drops generated.ts into <cwd>/src/types/, leaving the real
// one stale while the script reports success.
const OUT = resolve(HERE, '../src/types/generated.ts');

const source = process.argv[2] ?? process.env.SPEC_SOURCE;

if (!source) {
    console.error(
        [
            'codegen: no spec source given.',
            '',
            'Set SPEC_SOURCE to the next spec. It may be a URL or a local path:',
            '',
            "  SPEC_SOURCE='https://…/spec/en/payments.yaml' yarn codegen   # internal feed",
            "  SPEC_SOURCE='../../../gopay-payments-api-v4/spec/payments.yaml' yarn codegen   # sideload",
            '',
            'See CLAUDE.md ("API Spec & Code Generation") for both sources.',
        ].join('\n'),
    );
    process.exit(1);
}

const isUrl = /^https?:\/\//i.test(source);

// Payments.yaml is what this script writes, not something it reads. Passing it back in reads
// the snapshot, writes it over itself and regenerates the types from whatever the snapshot
// happened to hold — so endpoints added upstream since the last refresh silently disappear
// from generated.ts. Refuse it rather than produce a plausible-looking rollback.
if (!isUrl && resolve(source) === SNAPSHOT) {
    console.error(
        [
            'codegen: Payments.yaml is the snapshot this script writes, not a spec source.',
            'Regenerating from it would roll the types back to whatever it already held.',
            'Pass the next spec instead — see CLAUDE.md ("API Spec & Code Generation").',
        ].join('\n'),
    );
    process.exit(1);
}

let spec;
if (isUrl) {
    console.error('→ Fetching the next spec ...');
    // The internal feed is shut down overnight and at weekends, so an unreachable host is the
    // expected case out of hours. Without a deadline a hanging connection stalls for minutes
    // instead of failing fast.
    let response;
    try {
        response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    } catch (err) {
        const reason =
            err.name === 'TimeoutError' ? 'timed out after 30s' : err.message;
        console.error(`codegen: could not fetch the spec (${reason}).`);
        console.error(
            'If the internal feed is down, sideload from a spec repo checkout instead.',
        );
        process.exit(1);
    }
    if (!response.ok) {
        console.error(
            `codegen: fetch failed: ${response.status} ${response.statusText}`,
        );
        process.exit(1);
    }
    spec = await response.text();
} else {
    if (!existsSync(source)) {
        console.error(`codegen: spec source not found: ${source}`);
        process.exit(1);
    }
    console.error(`→ Reading the next spec from ${source} ...`);
    spec = readFileSync(source, 'utf8');
}

// The pre-release feed injects a Prism mock server as the FIRST servers entry so that the
// Elements docs UI has a working "Try It". The mock server itself is fine and stays where it
// runs — but it must never reach a vendored spec file: servers[0] is the default base URL for
// any OpenAPI tooling that opens Payments.yaml, and the published spec lists only Sandbox and
// Production. Strip it here so the snapshot is correct no matter which source it came from.
console.error('→ Stripping the injected mock server from servers ...');
// Indentation is captured rather than hardcoded: the feed currently emits a 2-space block list,
// but a re-indented or differently-serialised feed must not silently stop matching. The
// continuation lines are those indented deeper than the "- " itself.
const MOCK_ENTRY =
    /\n([ \t]*)- url:[ \t]*['"]?[^\n'"]*payments-api-mock[^\n'"]*['"]?[^\n]*\n(?:\1[ \t]+[^\n]*\n)*/g;
const matches = spec.match(MOCK_ENTRY)?.length ?? 0;
spec = spec.replace(MOCK_ENTRY, '\n');
console.error(
    `   removed ${matches} mock server ${matches === 1 ? 'entry' : 'entries'}`,
);

// Fail closed: if the strip missed a shape we did not anticipate, stop rather than generate.
// Shipping a vendored spec that points at the mock host is the bug this prevents, and a
// silent no-op here is how it would come back.
if (spec.includes('payments-api-mock')) {
    console.error(
        [
            'codegen: ERROR — a mock server reference is still present after stripping.',
            'The spec feed changed the shape of this entry; update MOCK_ENTRY in this script.',
        ].join('\n'),
    );
    process.exit(1);
}

// Stage both outputs, then move them into place only once type generation has succeeded.
// Writing the snapshot first and generating from it in place would leave a refreshed
// Payments.yaml beside an unchanged generated.ts whenever openapi-typescript fails — two
// committed files describing different specs, with nothing in either saying so.
const TMP_SPEC = `${SNAPSHOT}.tmp`;
const TMP_OUT = `${OUT}.tmp`;

const cleanup = () => {
    for (const f of [TMP_SPEC, TMP_OUT]) {
        if (existsSync(f)) {
            rmSync(f);
        }
    }
};

writeFileSync(TMP_SPEC, spec, 'utf8');

console.error('→ Generating types ...');
// cwd is pinned to internal/core for the same reason OUT is: `yarn exec` resolves the binary
// from the working directory, so invoking the script from the repo root would otherwise fail
// with "command not found: openapi-typescript".
const result = spawnSync(
    'yarn',
    ['exec', 'openapi-typescript', TMP_SPEC, '-o', TMP_OUT],
    {
        stdio: 'inherit',
        cwd: resolve(HERE, '..'),
    },
);

if (result.status !== 0 || !existsSync(TMP_OUT)) {
    cleanup();
    console.error(
        'codegen: type generation failed — Payments.yaml and generated.ts left as they were.',
    );
    process.exit(result.status ?? 1);
}

// Two renames cannot be one atomic step, so the second is guarded: if it fails after the first
// has landed, put the old snapshot back rather than leaving a refreshed Payments.yaml beside a
// stale generated.ts — the exact split this staging exists to prevent.
const previousSnapshot = existsSync(SNAPSHOT)
    ? readFileSync(SNAPSHOT, 'utf8')
    : null;
renameSync(TMP_SPEC, SNAPSHOT);
try {
    renameSync(TMP_OUT, OUT);
} catch (err) {
    if (previousSnapshot === null) {
        rmSync(SNAPSHOT, { force: true });
    } else {
        writeFileSync(SNAPSHOT, previousSnapshot, 'utf8');
    }
    cleanup();
    console.error(
        `codegen: could not write ${OUT} (${err.message}) — rolled Payments.yaml back.`,
    );
    process.exit(1);
}
console.error('→ Wrote Payments.yaml and generated.ts');
