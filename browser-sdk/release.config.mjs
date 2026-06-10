import { analyzeCommits } from 'semantic-release-monorepo';

/** @type {import('semantic-release').GlobalConfig} */
export default {
    branches: ['master'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template, not JS
    tagFormat: 'browser-sdk-${version}',

    // analyzeCommits is set at the top level (not inside plugins) so the monorepo
    // decorator can intercept plugins[0] (@semantic-release/commit-analyzer) and
    // filter commits to only those that touched browser-sdk/ before letting the analyzer
    // decide the version bump. If no relevant commits exist, the entire release is
    // skipped — this package only releases when browser-sdk/ files change.
    // Note: internal/core/ changes are NOT included in this filter (semantic-release-monorepo
    // v8 matches only the package's own directory). Core-only changes bump gopay-js-sdk (which
    // analyzes all commits) but not this package.
    analyzeCommits,

    plugins: [
        // analyzeCommits above calls this at index 0 with path-filtered commits
        '@semantic-release/commit-analyzer',

        // Generate release notes (uses all commits since last tag — see note below)
        // Note: release notes may include commits from sdk/ or internal/core/,
        // but the version bump and release gate are controlled by the filtered analyzeCommits above.
        '@semantic-release/release-notes-generator',

        // Update CHANGELOG.md
        [
            '@semantic-release/changelog',
            {
                changelogFile: 'CHANGELOG.md',
            },
        ],

        // Bump version in package.json and publish to npm.
        // .npmrc sets workspaces=false so npm version doesn't choke on workspace:* devDeps.
        ['@semantic-release/npm', { npmPublish: true }],

        // Commit version bump + CHANGELOG back to the repo
        [
            '@semantic-release/git',
            {
                assets: ['package.json', 'CHANGELOG.md'],
                message:
                    // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template string, not JS
                    'chore(release): browser-sdk-${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
            },
        ],
    ],
};
