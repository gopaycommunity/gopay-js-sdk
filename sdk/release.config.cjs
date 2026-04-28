/** @type {import('semantic-release').GlobalConfig} */
module.exports = {
    branches: ['master'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template, not JS
    tagFormat: '${version}',
    plugins: [
        // Analyze commits to determine version bump (feat → minor, fix → patch, BREAKING CHANGE → major)
        '@semantic-release/commit-analyzer',

        // Generate release notes from commits
        '@semantic-release/release-notes-generator',

        // Update CHANGELOG.md
        [
            '@semantic-release/changelog',
            {
                changelogFile: 'CHANGELOG.md',
            },
        ],

        // Bump version in package.json.
        // We use exec+node instead of @semantic-release/npm because `npm version` (used
        // internally by @semantic-release/npm) does not understand Yarn's `workspace:*`
        // protocol used in example/package.json.
        //
        // When ready to publish to npm, replace this block with:
        //   ['@semantic-release/npm', { npmPublish: true }]
        // and ensure NPM_TOKEN is set in Bitbucket repository variables.
        [
            '@semantic-release/exec',
            {
                // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template, not JS
                prepareCmd: 'npm pkg set version=${nextRelease.version}',
            },
        ],

        // Commit version bump + CHANGELOG back to the repo
        [
            '@semantic-release/git',
            {
                assets: ['package.json', 'CHANGELOG.md'],
                message:
                    // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template string, not JS
                    'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
            },
        ],
    ],
};
