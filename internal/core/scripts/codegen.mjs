#!/usr/bin/env node
// Regenerate src/types/generated.ts from the "next spec" — the upcoming version of the GoPay
// Payments API spec, ahead of what api-docs.gopay.com publishes.
//
// Run: SPEC_SOURCE=<url-or-path> yarn codegen
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
const OUT = 'src/types/generated.ts';

const source = process.argv[2] ?? process.env.SPEC_SOURCE;

if (!source) {
    console.error(
        [
            'codegen: no spec source given.',
            '',
            'Set SPEC_SOURCE to the next spec. It may be a URL or a local path:',
            '',
            '  SPEC_SOURCE=<url> yarn codegen                                    # internal feed',
            '  SPEC_SOURCE=../../../<spec-repo>/spec/payments.yaml yarn codegen  # sideload',
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
    const response = await fetch(source);
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
const MOCK_ENTRY =
    /\n {2}- url:[ \t]*['"]?[^\n'"]*payments-api-mock[^\n'"]*['"]?[^\n]*\n(?: {4}[^\n]*\n)*/g;
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
const result = spawnSync(
    'yarn',
    ['exec', 'openapi-typescript', TMP_SPEC, '-o', TMP_OUT],
    {
        stdio: 'inherit',
    },
);

if (result.status !== 0 || !existsSync(TMP_OUT)) {
    cleanup();
    console.error(
        'codegen: type generation failed — Payments.yaml and generated.ts left as they were.',
    );
    process.exit(result.status ?? 1);
}

renameSync(TMP_SPEC, SNAPSHOT);
renameSync(TMP_OUT, OUT);
console.error('→ Wrote Payments.yaml and generated.ts');
