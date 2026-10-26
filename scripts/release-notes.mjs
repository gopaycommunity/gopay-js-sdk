/**
 * Release notes link to the public GitHub mirror, never to the internal Bitbucket repository.
 *
 * Shared by sdk/release.config.mjs and browser-sdk/release.config.mjs. semantic-release builds
 * the commit and compare links from `repositoryUrl`, which has to stay the Bitbucket origin
 * because that is where it pushes the release commit and tag. Those links end up in
 * CHANGELOG.md, in the release commit message and in the npm tarball, and all three are
 * public, so the notes are pointed at the mirror instead. The mirror is a force-push of
 * Bitbucket master and its tags, so every commit hash and tag the notes name exists there.
 */
import { fileURLToPath } from 'node:url';

const GITHUB_HOST = 'https://github.com';
const GITHUB_OWNER = 'gopaycommunity';
const GITHUB_REPOSITORY = 'gopay-js-sdk';

// "#12" and "@name" in a commit name a Bitbucket pull request or user, which mean nothing on the
// mirror. The preset's transform links them from the Bitbucket context before finalizeContext
// runs, so they are turned back into plain text here.
const HOST_LINK = /\[([#@][^\]]*)\]\([^)]*\)/g;
const INTERNAL_HOST = /bitbucket\.org|atlassian\.net/i;
// Any other GoPay host is internal until it is listed here, so a subject that names an internal
// feed is caught without this file having to name it (CLAUDE.md keeps that hostname to itself).
const GOPAY_HOST = /\b(?:[a-z0-9-]+\.)+gopay\.(?:com|cz|io)\b/gi;
const PUBLIC_GOPAY_HOSTS = new Set(['api-docs.gopay.com']);

const internalHostIn = (notes) => {
    const named = INTERNAL_HOST.exec(notes);
    if (named) {
        return named[0];
    }
    for (const [host] of notes.matchAll(GOPAY_HOST)) {
        if (!PUBLIC_GOPAY_HOSTS.has(host.toLowerCase())) {
            return host;
        }
    }
    return null;
};

const unlink = (text) =>
    typeof text === 'string' ? text.replace(HOST_LINK, '$1') : text;

/** `writerOpts` for @semantic-release/release-notes-generator. */
export const publicReleaseNotesWriterOpts = {
    finalizeContext: (context) => ({
        ...context,
        host: GITHUB_HOST,
        owner: GITHUB_OWNER,
        repository: GITHUB_REPOSITORY,
        commit: 'commit',
        commitGroups: context.commitGroups.map((group) => ({
            ...group,
            // "closes #12" references name Bitbucket pull requests too.
            commits: group.commits.map((commit) => ({
                ...commit,
                subject: unlink(commit.subject),
                references: [],
            })),
        })),
    }),
};

/**
 * This module is also a semantic-release plugin, listed by this path after
 * release-notes-generator. Its generateNotes step fails the release, and the PR's dry-run
 * preview, if the notes still name an internal host: generateNotes runs in dry-run too and gets
 * the notes the plugins before it produced, and returning nothing adds nothing to them.
 *
 * A path rather than an inline plugin object, because browser-sdk's semantic-release-monorepo
 * imports every listed plugin by name and rejects anything that is not a string. It has to be
 * absolute: the monorepo decorator resolves names from its own directory, not from the config.
 */
export const assertPublicReleaseNotes = fileURLToPath(import.meta.url);

export function generateNotes(_pluginConfig, { nextRelease }) {
    const host = internalHostIn(nextRelease.notes ?? '');
    if (host) {
        throw new Error(
            `Release notes name the internal host ${host}. They are public (CHANGELOG.md, the release commit, npm), so they may only link to ${GITHUB_HOST}/${GITHUB_OWNER}/${GITHUB_REPOSITORY}.`,
        );
    }
}
