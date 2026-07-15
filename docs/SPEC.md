# SRS Flashcard App — Build Spec (v3.2)

> A dead-simple React Native Anki-style flashcard app for iPhone. Import decks, review them with an SM-2 scheduler, nothing more. Built to iterate on collaboratively.
>
> **Status:** v3.2 — execution-ready, reconciled against the actual SDK 57 scaffold. This doc is the single source of truth for build order and contracts. Keep it tight — it also serves as (or seeds) the repo's `CLAUDE.md`.
>
> **Rule for future passes:** add *precision*, not features. The MVP feature set is frozen as of v2; further changes should be corrections or clarifications to things already in scope.

---

## 1. Scope

**In scope (MVP):**
- Import decks from a file (cards come only from import)
- Browse decks; see how many cards are due
- Review session: show front → reveal back → rate with 4 buttons → scheduler updates the card
- SM-2 spaced-repetition scheduling, with **in-session requeue** for cards rated Again (§4.2)
- **Deck deletion** (the escape hatch for bad imports)
- Local persistence (survives app restarts)
- **Field sanitization** on import — strip HTML, handle furigana markup (§5.3)

**Explicitly out of scope (for now):**
- Ad hoc card creation or deletion (cards exist only via import; whole-deck delete is in scope)
- Editing cards
- Accounts, sync, cloud, sharing
- Media (audio/images) in cards
- HTML/CSS Anki card *templates* (plain front/back text only)
- Furigana *rendering* (ruby text) — stripped to readable plain text for now; rendering is backlog
- Android (target iPhone via Expo Go)
- FSRS scheduler (SM-2 first; the door stays open — see §4)
- In-app `.apkg` parsing (covered instead by TSV export / converter script — §5.2)

The scope constraints are the whole point: they remove everything that makes an Anki clone hard, leaving a small, well-defined core.

**Known limitation (accepted):** Expo Go only runs the latest Expo SDK. When the Expo Go app auto-updates on a device and the project hasn't bumped its SDK, the app will fail to load until the project is upgraded. Accepted for now; TestFlight (requires a $99/yr Apple Developer account) is the real fix if the tool sticks.

---

## 2. Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Expo (managed) + React Native | Run in **Expo Go** on device — no Apple Developer account needed for iteration (see SDK caveat in §1) |
| Language | TypeScript | The scheduler contract is much clearer with types |
| Navigation | Expo Router (file-based, built on React Navigation) | **Decided v3.1.** Use the default Expo template. File-based routing means the filesystem *is* the navigation config — no screen registration to get wrong across build sessions. Do NOT mix in imperative React Navigation setup |
| Persistence | `expo-sqlite` | **Decided.** Relational fits decks/cards/review-log cleanly, works in Expo Go, and FSRS-later wants query-able history |
| File import | `expo-document-picker` + `expo-file-system` | Pick a file, read its contents |
| State | React state + Context | No Redux — the app is small |

---

## 3. Data Model

Three tables. The review log is **required**, not optional: FSRS is trained on full review history, so the log is the prerequisite for ever making that swap. It costs one insert per review.

**`decks`**
| column | type | notes |
|---|---|---|
| id | integer PK | |
| name | text | from import |
| created_at | integer | epoch ms |

**`cards`**
| column | type | notes |
|---|---|---|
| id | integer PK | |
| deck_id | integer FK → decks.id | ON DELETE CASCADE (deck deletion removes cards + log) |
| front | text | sanitized on import (§5.3) |
| back | text | sanitized on import (§5.3) |
| position | integer | import order within the deck — new cards are introduced in this order |
| ease_factor | real | starts 2.5, floor 1.3 |
| interval | integer | days until next due |
| repetitions | integer | consecutive correct recalls |
| due_date | integer | epoch ms, **day-granularity** — start of the due day at the 4am rollover (§4.3) |
| created_at | integer | epoch ms |

**`review_log`** *(required)*
| column | type | notes |
|---|---|---|
| id | integer PK | |
| card_id | integer FK → cards.id | ON DELETE CASCADE |
| rating | integer | 0–3 (Again/Hard/Good/Easy) |
| reviewed_at | integer | epoch ms (exact timestamp, not day-granularity) |
| prev_interval | integer | |
| new_interval | integer | |

A freshly imported card starts as: `ease_factor = 2.5`, `interval = 0`, `repetitions = 0`, `due_date = start of today` (i.e. immediately due / "new").

---

## 4. Scheduler Contract (the "brain")

Isolate this as a **pure module** with **no I/O and no DB access** so it's trivially unit-testable and swappable (SM-2 → FSRS later).

The scheduler returns an **interval in days**, not a due date. A thin app-layer function owns the interval → due-timestamp conversion, so the day-boundary/rollover policy never leaks into the pure module.

```ts
type Rating = 'again' | 'hard' | 'good' | 'easy';

interface SchedulerState {
  easeFactor: number;   // EF
  interval: number;     // days
  repetitions: number;  // n
}

interface Scheduler {
  // pure: given current state + rating, return next state (interval in days)
  review(state: SchedulerState, rating: Rating): SchedulerState;
}

// app layer, NOT part of the scheduler module:
// dueDate = startOfDay(now, ROLLOVER_HOUR) + next.interval days
```

Everything else in the app depends on the `Scheduler` interface, never on the SM-2 details. Swapping in FSRS later means writing one new implementation.

### 4.1 SM-2 reference implementation (with Hard and Easy multipliers)

Map the 4 buttons to SM-2 quality scores `q`:

| Button | q |
|---|---|
| Again | 0 |
| Hard | 3 |
| Good | 4 |
| Easy | 5 |

**Deviations from textbook SM-2 (deliberate):** textbook SM-2 gives q=3, q=4, and q=5 *identical intervals* on any given review — they differ only in EF drift. That violates user expectations twice over: Hard should be shorter than Good, and Easy should be longer. Fixes, both borrowed from Anki's defaults:

- **Hard** on a graduated card multiplies the interval by **`HARD_MULTIPLIER = 1.2`** instead of by EF (still takes the EF penalty).
- **Easy** multiplies by **EF × `EASY_BONUS = 1.3`**.
- **Easy on a new card** (`repetitions == 0`) graduates straight to **4 days** instead of 1, so Easy is meaningful across the card's whole life.

```
HARD_MULTIPLIER = 1.2
EASY_BONUS      = 1.3
EASY_GRADUATE   = 4      # days

if q < 3:                        # lapse (Again)
    repetitions = 0
    interval    = 1
else:                            # recalled
    if repetitions == 0:
        interval = EASY_GRADUATE if q == 5 else 1
    elif repetitions == 1:
        interval = 6
    elif q == 3:                 # Hard
        interval = round(interval * HARD_MULTIPLIER)
    elif q == 4:                 # Good
        interval = round(interval * easeFactor)
    else:                        # Easy
        interval = round(interval * easeFactor * EASY_BONUS)
    repetitions += 1

# EF always updates, then clamps
easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
easeFactor = max(1.3, easeFactor)
```

**Worked example** (mature card: interval 10, EF 2.5): Hard → 12, Good → 25, Easy → 33. Monotonic, matching §9.

**Required unit test:** for a graduated card with any valid EF, assert `interval(hard) < interval(good) < interval(easy)`. This is the invariant that v2 claimed but didn't deliver — pin it with a test so it can't regress.

*(The remaining fidelity gap vs Anki — relearning steps — is handled at the session level, not in the scheduler: see §4.2.)*

### 4.2 In-session requeue (the learning-steps substitute)

Pure SM-2 has a fatal UX flaw for new material: press **Again** on a new card and it's gone until tomorrow — one exposure per day. Anki solves this with learning steps (1min, 10min); we solve it more cheaply at the **session queue** level, with no schema or scheduler change:

- When a card is rated **Again**: persist the scheduler result as normal (it's a lapse; the log records it), and **also requeue the card** into the current session.
- **Requeue position:** insert at `min(queue.length, 3)` positions from the current point. Guarantee: **other remaining cards, if any, come first**. If the Again'd card is the *only* card left in the session, it re-shows immediately — accepted behavior, not a bug.
- The card keeps reappearing within the session until it earns a non-Again rating.
- No timers, no sub-day due dates — "a few cards from now" is the approximation of "10 minutes from now."

**Persistence semantics (intentional — do not "fix"):** a card can be written multiple times in one session (Again → requeue → Good means two scheduler runs and two card-row writes). **The last write wins on the card row; the review log keeps every attempt.** The double-write is by design: the log's completeness is what makes a future FSRS swap possible.

This is ~20 lines in the Review screen's queue logic and transforms the study experience for new cards.

### 4.3 Day boundary

- **Rollover hour: 4am** local (Anki's default — correct for anyone who studies past midnight, which describes language students).
- All `due_date` values are stored at day granularity: the epoch ms of the rollover instant of the due day.
- "Due" = `due_date <= now`. Because due dates sit at day starts, a card reviewed at 9pm with interval 1 is due at 4am tomorrow — it correctly appears in the next morning's session.
- Helpers: `startOfDay(now, ROLLOVER_HOUR=4)` and `intervalToDueDate(now, intervalDays)` live in one small dateUtils module; `getDueCards` and the scheduler-persist path both use them.

---

## 5. Deck Importer Contract

One interface, multiple formats behind it.

```ts
interface ParsedDeck {
  name: string;
  cards: { front: string; back: string }[];
}

interface DeckImporter {
  canHandle(filename: string): boolean;
  parse(fileContents: string): ParsedDeck;
}
```

### 5.1 Format priority

The app's purpose is to be a *practical* Anki reader — and real decks (Core2k/6k, Kaishi, etc.) live in Anki:

1. **TSV (Anki plain-text export) — ship first.** Anki desktop natively exports any deck via *Export → Notes in Plain Text (.txt)*. The classmate can self-serve **any existing deck** into the app with zero extra tooling. Column resolution is specified in §5.2 — it is the part most likely to silently import garbage if done naively.
2. **JSON** — `{ "name": "...", "cards": [{ "front": "...", "back": "..." }] }`. Trivial; nice for hand-rolled and script-generated decks.
3. **`.apkg` converter script — desktop-side, not in-app.** A ~50-line Python script: unzip the `.apkg`, read the embedded SQLite, dump JSON in the format above. Gets full `.apkg` content on day one while keeping the genuinely fiddly parsing out of the app forever (or until it's worth doing in-app). Also a good self-contained task for the classmate.
4. **In-app `.apkg`** — backlog, only if the converter script proves annoying in practice.

Import flow: pick file → `parse()` → sanitize fields → preview count + deck name, confirm → write one `decks` row + N `cards` rows (with `position` = row order) in a transaction.

**Re-import behavior (decided):** importing the same file twice creates a duplicate deck. No dedupe logic in MVP — deck deletion (§6) is the escape hatch.

### 5.2 Anki plain-text column resolution (normative)

Anki's export prepends `#`-prefixed directives, and depending on export settings the leading data columns may be **notetype and/or deck, not front/back**. Naive "first two columns" can import `Basic` / `Core2k` as a flashcard. The parser MUST resolve columns via the directives:

1. **Separator:** read the `#separator:` directive if present (`tab`, `comma`, `semicolon`, or a literal character). Default: tab. Do not hardcode tab.
2. **Directive lines:** consume all leading lines starting with `#` before parsing rows. Recognize at minimum: `#separator:`, `#html:`, `#notetype column:N`, `#deck column:N`, `#tags column:N` (columns are 1-indexed).
3. **Column mapping:** build the set of *excluded* column indices from the `notetype`/`deck`/`tags` directives. The **first two non-excluded columns**, in order, are front and back. Ignore any further columns.
4. **Quoted fields:** fields containing the separator character, quotes, or literal newlines are wrapped in double quotes with `""` escaping (CSV-style). The row parser MUST handle quoted fields — naive `split(sep)` is incorrect. Within-field line breaks otherwise arrive as `<br>` and are handled by sanitization (§5.3); parse (unquote/split) **first**, sanitize **second**.
5. **Deck name:** not in the file — derive from the filename, editable at the import preview.

**Belt-and-suspenders (documented for the human, not load-bearing):** recommended export settings are "Notes in Plain Text", include HTML off if available, notetype/deck columns unchecked. The parser must still be correct when they're checked.

**Required unit tests:** (a) a file with `#notetype column:1` and `#deck column:2` where front/back are columns 3–4; (b) a quoted field containing the separator and a `""` escape; (c) a field containing `<br>` proving the parse-then-sanitize order.

### 5.3 Field sanitization (Japanese-deck reality)

Even with card *templates* out of scope, Anki-sourced **field content** contains markup. Rendered raw, a Japanese deck looks broken. After row parsing (§5.2), every field passes through one `sanitizeField()` function:

- Strip HTML tags; convert `<br>`/`<div>` boundaries to newlines; decode entities (`&nbsp;`, `&amp;`, …)
- Convert Anki furigana syntax `漢字[かんじ]` → `漢字（かんじ）`. **The pattern must be anchored to kanji-followed-by-kana** — approximately `/([一-龯々]+)\[([ぁ-ゖァ-ヺー]+)\]/g` — so legitimate bracket content (e.g. `[1]`, `[sic]`, English notes) is left untouched.
- Strip `<ruby>`/`<rt>` tags to the same parenthesized form
- Trim whitespace; drop rows where front is empty after sanitization

**Required unit tests:** real exported rows including furigana, `<ruby>` markup, entities, and non-furigana bracket content that must survive unmodified. This module is a Definition-of-Done criterion (§9) — test it like one.

---

## 6. Screens (3)

Expo Router file layout — **as scaffolded by the SDK 57 default template, the router root is `src/app/`, not a top-level `app/`** (verified against the actual scaffold, 2026-07-15):

| Screen | Route file | Path |
|---|---|---|
| Deck List (home) | `src/app/index.tsx` | `/` |
| Import | `src/app/import.tsx` | `/import` |
| Review | `src/app/review/[deckId].tsx` | `/review/:deckId` |

`src/app/_layout.tsx` renders the **root `<Stack>`** — Deck List → Import → Review is push navigation. The template ships a tab-based layout (`AppTabs`) and a demo `explore.tsx`; step 1 replaces the tabs with a Stack and deletes the demo screen. Do not keep tabs.

Non-route modules live as siblings of the router root, never inside it (anything in `src/app/` becomes a screen):

```
src/
  app/          # routes only
  db/           # sqlite setup, repositories
  scheduler/    # pure SM-2 module + tests
  importers/    # DeckImporter interface, TSV, JSON, sanitizeField
  lib/          # dateUtils (rollover), shared helpers
```

Route params arrive as strings from `useLocalSearchParams` — cast `deckId` with `Number()` at the screen boundary.

**A. Deck List (home)**
- Lists all decks with a due count each (cards where `due_date <= now`)
- Button → Import
- Tap a deck → Review
- **Long-press a deck → Delete (with confirm).** Cascades to cards + review log. One DB call; the escape hatch for bad imports.

**B. Import**
- Pick a file via document picker
- Parse via the matching `DeckImporter` (§5.2 column resolution), sanitize (§5.3), preview count + deck name, confirm → write to DB
- Return to Deck List

**C. Review (study session)**
- Build a queue for the deck: due cards + new cards up to the daily cap
  - **`NEW_PER_DAY = 20`** (constant for now)
  - **New cards are introduced in import order** (`position`) — never shuffled. Core decks are frequency-ordered; shuffling destroys the most valuable property of the deck.
- Show **front**; tap → reveal **back**
- Four buttons: **Again / Hard / Good / Easy**
- On tap: run scheduler → persist card + review-log row → advance
- **Again additionally requeues the card into the current session** per §4.2 (position rule, last-write-wins semantics)
- When queue empties (including requeued cards): "Done" state → back to Deck List

---

## 7. Build Order (scoped for one ~1-hour session each)

Each step is a self-contained Claude Code task that fits inside a single usage window. Do them in order; each leaves the app runnable.

1. **Scaffold** — `npx create-expo-app` (default template → Expo Router + TS, router root at `src/app/`). Replace the template's tab layout with a root `<Stack>` in `src/app/_layout.tsx`; delete demo screens (`explore.tsx` etc.); create the three route files and sibling module dirs per §6. Deps for later steps (`expo-sqlite`, `expo-document-picker`, `expo-file-system`) are installed now via `npx expo install` so SDK compatibility is settled once, up front. Verify push navigation between all three screens on-device in Expo Go. *Step 4b note: check which `expo-file-system` API the installed SDK ships (new `File`/`Directory` classes vs. legacy async functions) before writing import code — the API has been mid-migration across recent SDKs.*
2. **DB layer** — `expo-sqlite` setup, schema/migrations (incl. `position`, cascading deletes, review_log), typed repository functions (`getDecks`, `getDueCards`, `insertDeck`, `deleteDeck`, `updateCard`, `insertReviewLog`, …), dateUtils (4am rollover).
3. **Scheduler** — pure SM-2 module (Hard ×1.2, Easy ×EF×1.3, Easy-graduate 4d) + unit tests incl. the monotonicity invariant (§4.1). No UI. (Highest-value, smallest surface.)
4. **Import 4a: TSV parser** — directive handling, separator resolution, quoted-field row parsing, column mapping (§5.2) + unit tests.
5. **Import 4b: sanitization + wiring** — `sanitizeField()` (§5.3) + unit tests against real export rows; `DeckImporter` interface; document picker → transactionally writes to DB.
6. **Deck List screen** — real data, due counts, deck delete.
7. **Review screen** — queue (due + new-per-day, import order), flip, rate, persist + log, in-session requeue per §4.2, done-state.
8. **Polish** — empty states, due-count refresh, import preview niceties, JSON importer (small).

**Later / iteration backlog:** `.apkg` converter script (can happen anytime, it's desktop-side) → furigana/ruby rendering → FSRS scheduler → global "study all due" queue → stats screen (review_log is already there) → in-app `.apkg` → TestFlight → Android.

---

## 8. Resolved Decisions

Quick reference for the executing model; rationale lives in the Changelog (§10).

| # | Question | Decision |
|---|---|---|
| 1 | Lapse behavior | Pure SM-2 lapse (reset to 1 day) **plus in-session requeue** for Again — no relearning-step machinery; requeue at `min(queue.length, 3)` positions back; last card-row write wins, log keeps every attempt |
| 2 | New-card introduction | `NEW_PER_DAY = 20`, **import order**, never shuffled |
| 3 | Day boundary | **4am rollover**, day-granularity due dates |
| 4 | Queue scope | **Per-deck** review only |
| 5 | Persistence | **`expo-sqlite`** |
| 6 | Import format first | **TSV (Anki plain-text export)** first with directive-based column resolution (§5.2); JSON second; `.apkg` via desktop converter script |
| 7 | Rating → interval mapping | Keep 0/3/4/5 q-mapping for EF, but: Hard = ×1.2, Good = ×EF, Easy = ×EF×1.3, Easy graduates new cards at 4 days. Invariant: Hard < Good < Easy on graduated cards |

---

## 9. Definition of Done (MVP)

- Export a real deck from Anki desktop as plain text and import it on-device via Expo Go — **including an export with notetype/deck columns present** (§5.2 resolves them)
- Japanese fields display cleanly (no HTML artifacts; furigana readable; non-furigana brackets untouched)
- See the deck in the deck list with a correct due count
- Run a review session; Again re-shows the card within the session; ratings visibly change when cards next come due (**Hard < Good < Easy** intervals on mature cards — enforced by unit test)
- Delete a deck and see it fully removed
- State survives a full app restart

---

## 10. Changelog

Decisions are recorded here as they're made so the chain of reasoning survives across sessions and models. Newest first. Format: version/date — change — why.

### v3.2 — 2026-07-15 (Sonnet ground-truth review against the actual scaffold)

- **Route layout corrected to `src/app/...` (Sonnet).** v3.1 specced a top-level `app/` beside `src/` from training-data knowledge of the Expo template; the actual SDK 57 scaffold nests the router root at `src/app/`. Resolution: follow the scaffold, not the spec — fighting the default template's layout would mean maintaining a config deviation across every forced SDK upgrade, the exact tax v3.1 chose Router to avoid. Non-route modules become siblings: `src/db`, `src/scheduler`, `src/importers`, `src/lib`. The intent (nothing non-route inside the router root) is unchanged. *Meta-lesson recorded: spec claims about scaffold structure written from model memory must be verified against the generated project — "Expo HAS CHANGED" applies to the spec's authors too.*
- **Root Stack made explicit (Sonnet).** The template ships tabs + a demo screen; §6 and step 1 now state outright: replace `AppTabs` with a root `<Stack>`, delete `explore.tsx`. Push navigation, no tabs.
- **§4.2 requeue wording fixed (Sonnet).** "Never literally at the end" overclaimed: with `min(queue.length, 3)`, an Again on the *sole remaining* card re-shows immediately. Restated as the true guarantee — other remaining cards, if any, come first; sole-card immediate re-show is accepted.
- **Pre-installed deps ratified.** `expo-sqlite`, `expo-document-picker`, `expo-file-system` stay installed at scaffold time (one `npx expo install` pins SDK-compatible versions before steps 2/4b start). Added a step-4b drift-watch: verify which `expo-file-system` API (new `File`/`Directory` vs. legacy async) the installed SDK ships before writing import code.
- **Added `Number(deckId)` boundary-cast note to §6** — `useLocalSearchParams` returns strings.

### v3.1 — 2026-07-15 (scaffold fork, decided at build time)

- **Navigation switched from React Navigation (imperative) to Expo Router (file-based), using the default Expo template.** A *precision* change under the v3 header rule — same three screens, same engine underneath (Expo Router is built on React Navigation), different wiring. Rationale: (1) the spec already accepts Expo Go's forced SDK churn, so going with the grain of the default template means every compelled upgrade follows the tested, documented path; (2) file-based routing removes the "where do I register this screen" decision entirely — the filesystem is the navigation config, which is the right constraint when a different Claude Code session builds each step; (3) current docs and ecosystem convention skew Router-ward, so generated code needs less correction. Costs accepted: mild routing magic a 3-screen app doesn't need; slightly clunkier typed route params. Hard rule carried over from the fork discussion: **don't mix** — no imperative React Navigation setup alongside Router.
- **Added the §6 route-file table and the `src/` convention** (non-route code lives outside `app/` so Router never treats it as a screen); rewrote build step 1 accordingly.

### v3 — 2026-07-14 (Opus review pass on v2, folded by Fable)

- **Fixed the Good/Easy interval contradiction (Opus).** v2 fixed Hard-vs-Good but left Good and Easy on the identical `interval × EF` path while §9 asserted `Hard < Good < Easy` — the same defect pattern v2 had diagnosed. Fix: `EASY_BONUS = 1.3` (Anki's default). The monotonicity invariant is now a required unit test so it can't be claimed without being delivered again.
- **Added Easy-graduate for new cards (Fable, while in the area).** Easy on a `repetitions == 0` card now graduates at 4 days instead of 1, matching Anki, so Easy is meaningful across the card's whole life — not only at maturity.
- **Specified normative TSV column resolution (Opus flagged; §5.2).** v2's "take the first two columns" silently imports notetype/deck as a card when those export columns are present. The parser now resolves columns from the `#` directives (`#separator:`, `#notetype column:N`, `#deck column:N`, `#tags column:N`), excludes flagged columns, and takes the first two remaining. Recommended export settings are documented but not load-bearing.
- **Required quoted-field parsing (Fable, extending Opus's embedded-tab note).** Anki wraps fields containing the separator/quotes/newlines in CSV-style double quotes with `""` escaping; naive `split(sep)` is incorrect. Parse order fixed: unquote/split first, sanitize second, with a `<br>` test row proving it.
- **Pinned requeue persistence semantics (Opus).** Again → requeue → pass writes the card row twice by design; last write wins, review log keeps every attempt (FSRS prerequisite). Explicitly marked "do not fix." Requeue position specified as `min(queue.length, 3)` back to handle the last-card degenerate case.
- **Scoped the furigana regex (Opus).** Conversion is anchored to kanji-followed-by-kana so legitimate bracket content (`[1]`, `[sic]`) survives; added to required sanitize tests since §9 makes it a DoD criterion.
- **Split build step 4 into 4a (TSV parse + column mapping) and 4b (sanitization + wiring) (Opus).** With directive handling and quoted fields, step 4 had outgrown a one-hour session. Build order is now 8 steps.
- **Added the "precision, not features" rule to the header.** v2 grew the MVP (sanitization, requeue, deck delete, TSV) for good reasons; that growth is now frozen. Contrast passes from here should correct and clarify, not expand.

### v2 — 2026-07-14 (Fable review pass on v1)

- **Import priority flipped to TSV-first; in-app `.apkg` dropped in favor of a desktop converter script.** The app's stated purpose is a practical reader for existing Anki decks; JSON-first made it useless for real decks until the hardest deferred feature landed. Anki desktop's native plain-text export lets the classmate self-serve any deck with zero code.
- **Added field sanitization to MVP.** Anki-sourced fields contain HTML and furigana markup (`漢字[かんじ]`); without stripping/conversion, real Japanese decks render broken. Furigana *rendering* (ruby) stays backlog.
- **Added in-session requeue for Again.** Pure SM-2 gives new cards one exposure per day (Again → due tomorrow), making new material nearly unlearnable. Session-level requeue substitutes for Anki's learning steps with no schema/scheduler change.
- **Due dates changed from exact timestamps to day granularity with a 4am rollover.** v1's exact timestamps meant a card reviewed at 9pm wasn't "due" the next morning. Day-start due dates + 4am rollover match Anki behavior and late-night study patterns.
- **Scheduler contract now returns an interval, not a due date.** Keeps rollover policy out of the pure module; the app layer owns interval → timestamp conversion.
- **Hard now multiplies interval by 1.2 on graduated cards.** Textbook SM-2 gives Hard and Good identical intervals; Anki's 1.2 hard multiplier is the minimal fix. *(v3 note: the same fix was needed for Easy — see above.)*
- **Review log promoted from optional to required.** FSRS needs full review history; the log is the prerequisite for that swap and costs one insert per review.
- **Deck deletion added to MVP.** With import-only content and no delete, a bad import lives forever. Long-press → delete, cascading.
- **Re-import decided: duplicates allowed, no dedupe.** Deck delete is the escape hatch.
- **New-card order decided: import order, never shuffled; `NEW_PER_DAY = 20`.** Core Japanese decks are frequency-ordered — shuffling destroys their most valuable property.
- **Added `position` column to `cards`** to support import-order introduction.
- **Documented Expo Go SDK-churn risk.** Expo Go only runs the latest SDK; an auto-update on the classmate's phone can break the app until the project upgrades. Accepted for MVP; TestFlight is the eventual fix.
- **Persistence closed: `expo-sqlite`.** Relational fits the review log and FSRS future; works in Expo Go.

### v1 — initial draft

- Scope, tech stack, data model, pure-scheduler and importer contracts, 3 screens, 7-step build order, 7 open questions.