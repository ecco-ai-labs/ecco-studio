# Story creation acceptance matrix

8 November 2026. These checks exercise production frontend modules. Browser service
responses are synthetic; PDF parsing, text editing, events, layout and navigation
are real. Passing these checks does not certify model quality or connected services.

| User workflow | Permanent coverage | Expected result |
| --- | --- | --- |
| New story; left navigation; library separation | STORY-01–03; story-workspace, story-format, navigation-history | Fresh fields; persistent navigation; story tabs absent from libraries |
| Three equal source buttons; keyboard and responsive layout | STORY-04 | Upload PDF / Generate With AI / Write remain equal and right aligned at 1440, 1024 and 390 px |
| Upload PDF, text or Markdown | UPLOAD-01; source-picker | Full preview; empty editable middle pane; clear errors for unsupported/oversized files |
| Physical PDF pages and ranges | UPLOAD-07–08; source-picker, source-chapters | Exact requested pages; Enter submits; no unselected page content |
| PDF bookmarks and chapter lookup | UPLOAD-07; source-picker, source-chapters | Complete 30,000+ character chapter; next chapter excluded, including shared boundary pages; ambiguous matches are not guessed |
| Native PDF highlighting | UPLOAD-08; source-picker | Dragging beyond an author line captures only that line; positioned newline spans preserve line breaks |
| Manual editing; Find and Replace; Clear Text | UPLOAD-08; source-picker | Middle text is editable; replacements affect only it; PDF remains intact |
| Save Draft and resume | UPLOAD-08; source-picker | Save Draft reveals Resume immediately; latest edited text and source resume intact; Apply submits the final edited text |
| AI prompt plus current story choices | STORY-04; UPLOAD-03; ai-generation-instructions, source-picker | Type, genre, age and language accompany instructions; changes persist back into Story Details |
| Improve only selected words or selected source | UPLOAD-03–05,07; source-picker, ai-text-refinement | No unselected source sent; output remains separate until Use AI Text |
| Mismatch and clarification handling | UPLOAD-02,04–05; source-compatibility, source-picker | Recommendations, selectable resolutions and Continue Anyway; no warning prose in AI output |
| Apply Text detects cast from final middle text | UPLOAD-06–08; story-workspace | Character count and properties update automatically; stale responses cannot overwrite newer edits |
| Output-specific character properties | UPLOAD-06; story-workspace, audio-emotion-binding | Audio voice properties; image/video appearance; explicit user choices preserved |
| Tab 2 changes update Tab 1, including Back | UPLOAD-03,06; story-workspace | Latest saved type, genre, audience and language rehydrate on return |
| Audio handoff, speaker mapping and emotions | audio-journey, audio-controls, audio-service, audio-mixed-voices | Exact applied text; identified voices; explicit emotion overrides AI defaults; manual turn overrides retained |
| Audition, compute selection and generation state | AUDIO-01; audio-controls, audio-worker-availability | Cached identical previews reused; Generate restored immediately after preview; unavailable workers never silently substituted |
| Image/video handoff, references, shots and timing | journey-handoff, generation-studio, video-flow, video-references | Correct studio; references retained by media type; chosen scenes and durations submitted |
| Job progress, cancellation and review | audio-flow-verification, generation-stop, activity-reading | Real service states required; duplicate submission guarded; errors and cancellation remain visible |
| Publishing selection and status | publishing-library, publishing-status | Correct reviewed output; receipt/state reconciliation; no false upload success |

## Verification boundaries

- Live AI translation, interpretation and character quality require an enabled AI connection.
- Live CPU/GPU synthesis, cancellation, signed-in persistence and YouTube publication require connected services and appropriate test accounts. Synthetic tests do not establish these outcomes.
- Story source selection accepts up to 100,000 characters. Audio synthesis retains its separate 4,000-character/80-turn service limits; a large chapter is not automatically a production-ready audio job.
- The browser suite covers Chrome. No claim is made for every browser, scanned/OCR-only PDF or every possible document layout.
- Test harness repairs track current public controls and adapter contracts, isolate component tests where full journeys have separate coverage, and disconnect observers before destroying JSDOM. They do not skip failing acceptance checks.

Run the broad Node regression suite using the command in `.github/workflows/story-workspace.yml`.
Run browser checks through `UX QA Agent` or `Release checks`; see `qa/README.md`.

## 2026-11-08 live service acceptance

The deployed complete-recording revision was checked on both existing CPU workers;
both advertise `long_form_version=1`. A real Kokoro CPU recording containing
85 turns and 5,090 source characters produced one 405.43-second, 48 kHz WAV.
Its 85 nonempty, ordered timeline entries cover the final WAV duration. This
checks completeness across inference batches; it is not a subjective audio-quality review.

A separate real backend AI test assigned all 576 ordered source units from
12,421 characters across two sections. The resulting speakers were Ali Baba,
Cassim, Morgiana, Narrator and The captain; exact source words were preserved.
This used synthetic story text through the live service and made no customer
story changes. Browser fixtures separately verify the frontend workflow.
