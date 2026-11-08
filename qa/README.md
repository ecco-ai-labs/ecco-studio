# Ecco UX QA Agent

Run `npm ci`, `npx playwright install --with-deps chrome`, then `npm test` from `qa/`.
The GitHub **UX QA Agent** workflow runs on every push and pull request and supports **Run workflow**.
Open the run summary for counts, failures and coverage; download `ecco-ux-qa-*` for `report/index.html`, screenshots, videos, traces and JSON.

The suite registers 85 Chrome browser checks: all five libraries in all three views, sorting/search, real image/video thumbnail pixels, story tabs and fresh drafts, AI instruction dialog, six themes, three viewport widths, preview focus, Workspace Drive and local sign-out, plus Desk selection/bulk ticketing and the browser Tester Agent itself.
The exact production frontend loads in a local fixture host. Service responses, identity and media are synthetic; external requests are intercepted and blocked. No live tickets, charges, GPU jobs or YouTube uploads occur. `coverage.json` explicitly lists backend workflows that remain blocked.

## AI screenshot inspection

Add repository secret `UX_QA_OPENAI_API_KEY` and variable `UX_QA_VISION_MODEL` with a vision-capable model available to that API project. The optional reviewer sends only synthetic test screenshots to the OpenAI Responses API, in batches of four. See `AI-VISUAL-REVIEW.json` for candidate issues; they require confirmation. Missing configuration is reported as BLOCKED, never a pass. Browser checks work without this key.

## Adding coverage and accepting changes

Add a user action and observable assertion to `tests/workflows.spec.js` for each new feature. Update `coverage.json` whenever coverage or blockers change. Use actual user clicks, media decode checks and visible computed styles. Never replace a failing expectation to make a regression pass, skip failures, or auto-approve screenshot baselines. There are no approved screenshot baselines yet: captures are evidence for review, not a claimed pixel-diff regression suite.

Every confirmed issue should become a permanent test. A failed browser assertion makes the workflow fail, but **branch protection must separately require `browser-workflows`** before it can block merges. This change does not claim to enforce repository protection or production deployment gates.

## Scope and prerequisites

Chrome stable only in v1. The official Chrome channel supplies the H.264 media codecs used by production MP4 files; bundled Chromium is not equivalent for these media assertions. This is registered workflow coverage, not proof of every possible path. Real OAuth, authenticated persistence, ticket delivery, payments, GPU generation/cancellation and external publishing require dedicated sandbox accounts/services before they can be tested end to end. Synthetic signed-in identity checks only frontend account behavior.

The fixture server is for local/CI use. Do not deploy it as a production server. Its `__qa=1` injection exists only in the local server; production HTML has no fixture entry point. Fixtures contain no customer records, credentials or production media. Regenerate sample media with FFmpeg if needed; the video is one second of green with a red left stripe.

## Today's known acceptance requirement

`THUMB-video-small` and `THUMB-video-large` require a visible decoded first-frame preview, not a generic film icon. On a revision without video thumbnails, both must fail. Once the product is fixed, the same checks must pass without weakening their assertions.

## Ecco Desk → Agents → Tester Agent

Select the agent, choose Check UX consistency / Perform a workflow / Run available workflow sweep, then select individual tests and choose Run selected tests. Nothing is selected by default; Select all tests is explicit. Changing scope clears the selection. Checks execute in this browser using the current Studio sign-in and connected data; keep Agents open. Stop cancels future checks. Current live workflows are all five libraries, individual image/audio/video library browsing, story entry and Workspace Drive. Each check records expected/observed behavior and reproduction steps. Media inspection waits up to 13 seconds per item, up to 20 items per library per icon size; remaining items are explicitly blocked/untested. No content is created, deleted, generated, purchased or published.

Review severity (editable before ticket creation), select individual rows or Select critical, optionally assign a team member, then Create N separate tickets. Staff findings create internal Bug tickets; customer findings create only their own support Bug tickets through existing server authorization. Critical maps to Urgent; High/Medium/Low to High/Normal/Low. Results stay on screen. Server rate limits still apply; a partial batch retains receipts and can resume. Ambiguous network writes are marked Receipt pending and never blindly retried. Refresh ticket status reconciles the unique finding marker against existing tickets. If no receipt can be confirmed, inspect Internal tasks before any manual submission.

Reports and ticket links persist for the latest ten runs in this browser, scoped to the Desk identity. Download report before changing browsers. Automatic CI results are separate: download qa-summary.json from the Actions artifact and use Import CI report; no GitHub token is placed in the browser. Raw screenshot/trace evidence remains in the Actions artifact. Browser checks are deterministic; optional AI review is not enabled by the Desk run button.

Validation: npm ci --prefix desk && npm run build --prefix desk; node tests/tester-agent.test.mjs; node tests/ecco-desk-agents.test.mjs; node tests/ecco-desk-access.test.mjs. The 25-of-50 bulk ticket scenario uses a fake API and never creates real tickets. AGENT-02 injects a hidden-row display defect only into the runner fixture, so detection is tested independently of whether production search is subsequently repaired. Production library checks receive no injected defect.

## Creating agents

Administrators and verified members of the configured administrator group can use Create New Agents at the top of the pool. Name the agent, add/reorder up to 12 supported check steps, then Create Agent. Definitions are shared in the server-backed pool and run sequentially; reports and tickets retain the existing review flow. This builder composes implemented browser checks; it does not execute arbitrary code, prompts, paid generation or publishing. Backend API version 1 is required. Validate authorization/persistence with `cd backend && python3 -m unittest test_ecco_desk_agents`.

PDF workflow checks load the real pinned PDF.js package from local npm assets through intercepted requests. The PDF fixture has two bookmarked chapters and a first chapter over 30,000 characters. Page/chapter extraction is real; AI improvement, compatibility and character responses remain synthetic. No external request is allowed through the fixture route.

The Story workspace checks job runs all top-level Node unit suites plus navigation,
popup, studio tabs, model selection, cancellation and publishing suites. See
[story-workflow-verification.md](story-workflow-verification.md) for the acceptance matrix.
