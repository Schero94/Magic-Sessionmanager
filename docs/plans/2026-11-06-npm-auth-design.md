# npm release authentication

The release job currently configures the npm registry but does not pass the repository npm secret to semantic-release. The OIDC exchange failed and the fallback npm authentication returned 401. The token's validity remains unknown.

Pass the existing `NPM_TOKEN` secret to the semantic-release step as both `NPM_TOKEN` and `NODE_AUTH_TOKEN`. Keep OIDC and the release trigger unchanged. Never log either value. This change does not publish a package or modify npm settings. A focused regression test must check the scoped environment variables and the existing job permissions; a successful live publish remains unverified until an authorized merge and release run.
