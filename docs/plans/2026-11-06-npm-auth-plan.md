# npm Authentication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide the existing npm secret to the release job without exposing its value.

**Architecture:** Preserve OIDC as the first choice and provide the same repository secret as token fallback only in the semantic-release step. Add a regression test covering the workflow contract.

**Tech Stack:** GitHub Actions, Node.js node:test, semantic-release.

### Task 1: Release workflow authentication

**Files:** Modify `.github/workflows/release.yml`; create `tests/release-auth-workflow.test.mjs`.

1. Add a focused test that reads the workflow and asserts that the semantic-release step maps both `NPM_TOKEN` and `NODE_AUTH_TOKEN` to the GitHub secret, retains `GITHUB_TOKEN`, and has OIDC permission.
2. Run `node --test tests/release-auth-workflow.test.mjs` and verify it fails for the missing mappings.
3. Add the two environment mappings to the semantic-release step only.
4. Run the focused test and `npm test`; verify both pass. Inspect `git diff --check` and the staged diff for secret values.
5. Commit and push the branch, then open a PR against `main`. Do not merge or trigger a release.
