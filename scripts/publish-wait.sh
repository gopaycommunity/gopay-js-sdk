#!/usr/bin/env bash
#
# Pushes every release tag this pipeline created to the GitHub mirror, one per push, then waits
# for the npm-publish run of each and fails if it did not publish.
#
# The tag push itself starts the workflow: npm-publish.yml listens on the `create` event, which
# GitHub does not suppress for [skip ci] commits (only push and pull_request are). No token is
# needed — the mirror is public, so its workflow runs are readable anonymously.
#
# Waiting is the point: without it a failed OIDC exchange or a rejected `latest` move would leave
# Bitbucket green and the release silently unpublished.
#
# Env: BITBUCKET_COMMIT
# Reads: release-head (artifact from the Release step)
set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-gopaycommunity/gopay-js-sdk}"
WORKFLOW_FILE="${WORKFLOW_FILE:-npm-publish.yml}"
API="https://api.github.com/repos/${GITHUB_REPO}"
# Anonymous API calls are capped at 60/hour per IP and Bitbucket runners share IPs, so poll slowly.
POLL_SLEEP="${POLL_SLEEP:-30}"
# Absolute per-tag deadline, so request timeouts cannot stretch the wait beyond it.
WAIT_BUDGET_S="${WAIT_BUDGET_S:-900}"
# Runs older than this are leftovers of an earlier delivery of the same tag, not ours.
STARTED_AT_MS=$(( $(date +%s) * 1000 - 5 * 60 * 1000 ))

# Anonymous GET with hard timeouts so a stalled request cannot eat the polling ceiling; a rate limit is reported as such.
gh_get() {
    local response code
    response=$(curl -sS --connect-timeout 10 --max-time 30 -w '\n%{http_code}' -H "Accept: application/vnd.github+json" "$1")
    code=${response##*$'\n'}
    if [ "$code" = 403 ] || [ "$code" = 429 ]; then
        echo "GitHub API rate limit hit while polling $1 — the publish may still succeed, check it on GitHub." >&2
        exit 1
    fi
    if [ "$code" != 200 ]; then
        echo "GitHub API $code for $1: ${response%$'\n'*}" >&2
        exit 1
    fi
    printf '%s' "${response%$'\n'*}"
}

# Newest run started by our tag delivery: "<id> <status> <conclusion>", or nothing yet. node, not
# jq: it is the only JSON tool guaranteed in the node:* image.
json_pick() { node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const since = Number(process.argv[1]);
        const runs = (JSON.parse(s).workflow_runs || []).filter((r) => Date.parse(r.created_at) >= since);
        const hit = runs[0];
        console.log(hit ? hit.id + " " + hit.status + " " + (hit.conclusion || "") : "");
    });
' "$1"; }

# --- which tags did THIS run create? -------------------------------------------------------
# Each package writes its own release commit, so on a joint release the sdk tag lands on HEAD~1
# and browser-sdk's on HEAD — reading only the head would silently skip the sdk publish.
# Assignment on its own line so a missing artifact trips set -e instead of collapsing the range.
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
    echo "Nothing released in this run; no tag to push, no publish to wait for."
    exit 0
fi

# --- push, one tag per push ---------------------------------------------------------------------
# GitHub emits no tag events for a push carrying more than three tags, so each release tag goes alone.
for tag in ${tags}; do
    git push github "refs/tags/${tag}"
done

# --- wait --------------------------------------------------------------------------------------
for tag in ${tags}; do
    # `branch` filters on head_branch, which GitHub sets to the tag name for tag events.
    runs_url="${API}/actions/workflows/${WORKFLOW_FILE}/runs?event=create&branch=${tag}&per_page=5"
    echo "==> Waiting for npm publish of ${tag}"

    run_id=""; status=""; conclusion=""
    deadline=$(( $(date +%s) + WAIT_BUDGET_S ))
    while [ "$(date +%s)" -lt "${deadline}" ]; do
        sleep "${POLL_SLEEP}"
        # Own line, not inside `read <<<$(...)`: only then does an API error fail the step via set -e.
        picked=$(gh_get "${runs_url}" | json_pick "${STARTED_AT_MS}")
        read -r run_id status conclusion <<<"${picked}"
        [ -n "${run_id:-}" ] && [ "${status}" = "completed" ] && break
        [ -n "${run_id:-}" ] && echo "    run ${run_id} ${status}..."
    done

    if [ -z "${run_id:-}" ]; then
        # Only a newly created tag fires `create`; a re-delivered one (re-run after a failed publish) does not.
        echo "Tag ${tag} was pushed but no npm-publish run appeared — cannot confirm the publish." >&2
        echo "  If the tag already existed on GitHub, start it by hand: Actions -> Publish to npm -> Run workflow, tag ${tag}." >&2
        echo "  https://github.com/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}" >&2
        exit 1
    fi
    if [ "${conclusion}" != "success" ]; then
        echo "Publish of ${tag} finished as '${conclusion:-timed out}'." >&2
        echo "  https://github.com/${GITHUB_REPO}/actions/runs/${run_id}" >&2
        exit 1
    fi
    echo "    published ${tag} (run ${run_id})"
done
