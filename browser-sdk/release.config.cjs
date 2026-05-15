const monorepo = require('semantic-release-monorepo');

/** @type {import('semantic-release').GlobalConfig} */
module.exports = monorepo({
    branches: ['master'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template, not JS
    tagFormat: 'browser-sdk-${version}',
    plugins: [
        // Analyze commits that touched browser-sdk/ (or internal/core via workspace dep) to determine version bump
        '@semantic-release/commit-analyzer',

        // Generate release notes from those commits
        '@semantic-release/release-notes-generator',

        // Update CHANGELOG.md
        [
            '@semantic-release/changelog',
            {
                changelogFile: 'CHANGELOG.md',
            },
        ],

        // Bump version in package.json. npmPublish: false until NPM_TOKEN is added and sign-off given.
        // To enable real publishing: set npmPublish: true and add NPM_TOKEN to Bitbucket repository variables.
        [
            '@semantic-release/npm',
            {
                npmPublish: false,
            },
        ],

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
});
