/** @type {import('semantic-release').GlobalConfig} */
module.exports = {
    branches: ['master'],
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

        // Publish to npm (reads NPM_TOKEN from env)
        [
            '@semantic-release/npm',
            {
                // npmPublish: true,
                // sdk is private for now
                npmPublish: false,
            },
        ],

        // Upload IIFE bundle to gopaycdn.com
        // TODO: replace the placeholder command with the actual CDN upload mechanism
        // [
        //   '@semantic-release/exec',
        //   {
        //     publishCmd:
        //       'curl -X PUT "https://gopaycdn.com/upload/js-sdk/${nextRelease.version}/gopay-sdk.min.js" \
        //        -H "Authorization: Bearer ${CDN_TOKEN}" \
        //        --data-binary @dist/gopay-sdk.min.js',
        //   },
        // TODO nebo generovat pull request na static
        // ],

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
