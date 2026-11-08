# GitHub Dev/Test → website Production

Ecco Desk administrators use **Releases** to review the changes since the last
production release, name a release, open its exact GitHub preview, then select
**Publish to Production**. Preparation never deploys. New development commits
do not change an already prepared release. **Prepare rollback** uses a previously
published build and also requires an explicit Publish action.

## Deployment boundaries

| Environment | Source and behavior |
|---|---|
| Dev/Test | `main`, automated checks and version previews on GitHub Pages |
| Production | Cloudflare Pages Direct Upload, `https://eccoailabs.com/`, manual artifact promotion only |
| Release service | Existing private CPU Desk service; verified administrator sessions |
| Source control | `ecco-ai-labs/ecco-studio`; production remains separate from normal pushes |

The initial pending collection represents the complete Studio. Later collections
show every commit since production, including fixes made directly on main.
Releases are complete snapshots, not independent file selections. Backend/API,
database and GPU/model changes are **not** deployed by this frontend publisher.
Their compatibility must be verified before releasing a frontend that needs them.

## One-time activation

The code does not claim these external settings are already configured.

1. Create a Cloudflare Pages **Direct Upload** project with production branch
   `production`. Do not connect automatic Git deployment. Set up `eccoailabs.com`
   as its custom domain and follow Cloudflare's returned DNS records. For an apex
   Pages domain, Cloudflare requires the zone on Cloudflare nameservers; keep
   registration at Squarespace and copy/verify existing mail and verification
   records before a nameserver change. The separate marketing domain stays separate.
2. In the GitHub **production** environment, store `CLOUDFLARE_API_TOKEN` as a
   secret with Cloudflare Pages Edit for the selected account. Set variables
   `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_PAGES_PROJECT`. Restrict that environment
   to `main`; use repository branch/ruleset protection to require reviewed release
   code. The manual workflow is the only production trigger.
3. Switch repository **Settings → Pages → Source** to **GitHub Actions** and set
   repository variable `ECCO_DEV_PAGES_ENABLED=true`. `Release checks` tests and
   builds main, then publishes Dev/Test plus the 10 latest immutable previews.
   The `dev-previews` branch retains only public static snapshots. Keep it out of
   the production hosting configuration.
4. Install `backend/ecco_releases.py` alongside the updated `ecco_desk.py` on the
   CPU service. The existing Desk installer includes the new module and additive
   SQLite table; inspect its normal pinned-source/restart prerequisites first.
   Also install `web_origins.py` and update the `storage_api.py` origin handling
   after comparing the deployed runtime with source. Do not overwrite live-only
   runtime modifications or restart during active jobs.
5. Give that service a repository-scoped GitHub credential with **Actions: write**,
   **Contents: read**, and metadata read. Save it privately, mode `0600`, at
   `/workspace/ecco-storage-private/releases-github.token`, or set
   `ECCO_RELEASE_GITHUB_TOKEN_FILE` to its private path. No key is entered in Desk,
   committed to GitHub, printed in logs or passed to a browser. This credential
   can dispatch deployments; create it only with the owner's authorization.
6. Configure the CPU service:
   ```text
   ECCO_ALLOWED_ORIGINS=https://ecco-ai-labs.github.io,https://eccoailabs.com
   ECCO_DEV_PREVIEWS_ENABLED=1
   ECCO_RELEASES_ENABLED=1
   ```
   Enable publishing only after the host, domain, sign-in and API checks below
   succeed. Existing unconfigured services continue to accept only the GitHub
   origin. Unknown origins are never reflected into CORS.
7. Add `https://eccoailabs.com` to the existing Google web OAuth client's
   authorized JavaScript origins. Confirm actual sign-in/sign-out and authorized
   storage/Desk access at that origin. Existing browser-local connections and
   drafts do not move between domains automatically; reconnect and export any
   local-only drafts before retiring the old customer entry point. Server media
   and Google subject identities remain on the existing service.
8. On the first passing main push, open Desk → Releases, prepare the initial
   release, inspect its GitHub preview, and publish. Verify the custom domain's
   `release.json` SHA, sign-in, libraries, support and service calls. The workflow
   separately verifies the host's canonical production deployment before writing
   a GitHub production release receipt.

GitHub repository administration, Cloudflare, Squarespace DNS and the private
CPU runtime require their respective owner connections. Merely merging this
change does not configure those accounts or activate a domain.

## Safety and recovery

- `Release checks` runs authorization/artifact tests and every registered Chrome
  fixture workflow. The tested static artifact has file hashes, source SHA and
  GitHub run ID. Synthetic checks are not proof of live payment, GPU, OAuth or
  external publishing behavior; the existing QA coverage records those limits.
- Publishing independently checks main ancestry, exact successful push run,
  artifact digest, file manifest and expected current production SHA. It uploads
  that artifact without rebuilding. Cloudflare secrets never reach a PR test.
- One production workflow runs at a time; later requests cannot overwrite a
  changed production baseline. Preparing another release is safe; publishing it
  requires current production to match its reviewed baseline.
- A timed-out dispatch stays **Checking receipt** and is not resent. Inspect the
  linked workflow or GitHub Actions for `Production release <id>`. If the host
  succeeded but receipt creation failed, reconcile the matching Cloudflare
  deployment into the GitHub receipt before publishing anything else. Never
  reset an unknown dispatch merely to retry it.
- Tested artifacts expire after 90 days; rollback is disabled by the server if
  its artifact is missing or expired. Re-run the original main push checks and
  prepare a new rollback, or retain release artifacts according to the desired
  operational rollback window. Do not substitute a rebuilt artifact silently.
- A pinned preview older than the last 10 successful development builds may no
  longer be hosted. Restore that artifact in GitHub Dev/Test before review;
  its production version remains pinned independently.

References: [GitHub custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
[Cloudflare Direct Upload](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/),
[Cloudflare custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).
