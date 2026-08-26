#!/usr/bin/env bash
#
# Triggers the GitHub npm-publish workflow for every tag this pipeline run created,
# then waits for each run and fails if it did not publish.
#
# A pushed tag cannot start the workflow on its own: semantic-release tags its release commit,
# whose message carries [skip ci], and GitHub Actions honours that on push events. So the publish
# is dispatched explicitly — workflow_dispatch is a different event and is not suppressed.
#
# Waiting is the point. `POST .../dispatches` returns 204 whether or not the publish later
# succeeds, so without polling a failed OIDC exchange or a rejected `latest` move would leave
# Bitbucket green and the release silently unpublished.
#
# Env: GITHUB_PERSONAL_ACCESS_TOKEN, BITBUCKET_COMMIT
# Reads: release-head (artifact from the Release step)
set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-gopaycommunity/gopay-js-sdk}"
WORKFLOW_FILE="${WORKFLOW_FILE:-npm-publish.yml}"
API="https://api.github.com/repos/${GITHUB_REPO}"
POLL_ATTEMPTS="${POLL_ATTEMPTS:-60}"   # x5s = 5 min ceiling per tag
POLL_SLEEP="${POLL_SLEEP:-5}"

gh_get() { curl -sS --fail-with-body -H "Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" \
    -H "Accept: application/vnd.github+json" "$1"; }

# Pull one field out of a JSON payload without depending on jq or python being present.
# node is guaranteed — this runs in the node:* image.
json_pick() { node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const runs = JSON.parse(s).workflow_runs || [];
        const hit = runs.find((r) => r.display_title === process.argv[1]);
        // Concatenation, not template literals, which would trip shellcheck SC2016 here.
        console.log(hit ? hit.id + " " + hit.status + " " + (hit.conclusion || "") : "");
    });
' "$1"; }

# --- which tags did THIS run create? -------------------------------------------------------
# Each package writes its own release commit, so on a joint release the sdk tag lands on HEAD~1
# and browser-sdk's on HEAD — reading only the head would silently skip the sdk publish.
# release-head is captured in the Release step because master can move on while docker builds.
# Assignment on its own line so a missing artifact trips set -e instead of collapsing the range
# to an empty one and skipping the publish quietly.
release_head=$(cat release-head)
new_commits=$(git rev-list "${BITBUCKET_COMMIT}..${release_head}")

tags=$(for sha in ${new_commits}; do git tag --points-at "${sha}"; done \
    | grep -E '^([0-9]+\.[0-9]+\.[0-9]+|browser-sdk-[0-9]+\.[0-9]+\.[0-9]+)$' \
    | sort -V || true)

if [ -n "${new_commits}" ] && [ -z "${tags}" ]; then
    echo "Release commits present but no release tag found — refusing to skip a publish silently." >&2
    exit 1
fi

if [ -z "${tags}" ]; then
    echo "Nothing released in this run; no publish to dispatch."
    exit 0
fi

# --- dispatch and wait ---------------------------------------------------------------------
# Ascending order: the workflow refuses to move `latest` backwards.
for tag in ${tags}; do
    echo "==> Dispatching npm publish for ${tag}"
    curl -sS --fail-with-body -X POST \
        -H "Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" \
        -H "Accept: application/vnd.github+json" \
        "${API}/actions/workflows/${WORKFLOW_FILE}/dispatches" \
        -d "{\"ref\":\"master\",\"inputs\":{\"tag\":\"${tag}\",\"dry-run\":\"false\"}}"

    # The dispatch response carries no run id, so the run is located by its run-name,
    # which npm-publish.yml sets to "Publish <tag>".
    run_id=""; status=""; conclusion=""
    for _ in $(seq 1 "${POLL_ATTEMPTS}"); do
        sleep "${POLL_SLEEP}"
        read -r run_id status conclusion <<<"$(gh_get \
            "${API}/actions/runs?event=workflow_dispatch&per_page=30" \
            | json_pick "Publish ${tag}")" || true
        [ -n "${run_id:-}" ] && [ "${status}" = "completed" ] && break
        [ -n "${run_id:-}" ] && echo "    run ${run_id} ${status}..."
    done

    if [ -z "${run_id:-}" ]; then
        echo "Dispatched ${tag} but never found its run — cannot confirm the publish." >&2
        exit 1
    fi
    if [ "${conclusion}" != "success" ]; then
        echo "Publish of ${tag} finished as '${conclusion:-timed out}'." >&2
        echo "  https://github.com/${GITHUB_REPO}/actions/runs/${run_id}" >&2
        exit 1
    fi
    echo "    published ${tag} (run ${run_id})"
done
