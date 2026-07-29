# Feature 4 Live DOM Date Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept the strictly observed Kakao dotted review date format at the memory-only extraction boundary, preserve all fail-closed rules, then create and validate a sanitized v2 selector contract without starting a provider collection run.

**Architecture:** Keep internal control dates, checkpoints, database fields, and encrypted payloads ISO-only. Add a provider-boundary normalizer inside `extract-review-page.ts` that accepts only ISO or the approved dotted calendar date, returns canonical ISO, and rejects every other form as `DOM_CONTRACT_CHANGED`. After automated verification, inspect one public logged-out Kakao place page with one browser tab and write the actual selector contract only if every required selector is structurally grounded and count-validated.

**Tech Stack:** TypeScript, Vitest, Zod, Playwright, pnpm, PowerShell, SQLite/Drizzle

## Global Constraints

- Main agent performs all work; no Subagent or parallel agent is allowed.
- Do not output nickname, review body, place locator, actual selector value, fingerprint, ciphertext, API key, or secret.
- Use one active browser page and stop immediately on login, CAPTCHA, 401, 403, 429, access denial, external origin redirect, or DOM/order change.
- Do not retry provider stops, use a proxy, bypass CAPTCHA, rotate accounts, or create browser artifacts.
- Keep raw review and locator retention at 30 days and seen fingerprint, sync state, run, checkpoint, and audit retention at 400 days.
- Do not start discovery or review collection until code, fixture, contract, environment, quota, policy, and operator gates all pass.

---

### Task 1: Normalize the Observed Kakao Dotted Date at the Extraction Boundary

**Files:**
- Modify: `apps/worker/src/reviews/extract-review-page.ts`
- Test: `apps/worker/src/reviews/extract-review-page.test.ts`

**Interfaces:**
- Consumes: `extractReviewPage(page, contract, options): Promise<ReviewPageResult>`
- Produces: an internal `normalizeReviewPublishedDate(value: string): string | null` used only for provider DOM review dates

- [ ] **Step 1: Write the failing dotted-date extraction test**

Add this test beside the existing ordered extraction cases:

```ts
it("normalizes a valid Kakao dotted date to ISO", async () => {
  const result = await extractReviewPage(
    fakePageFromHtml(
      oneReviewHtml({
        body: "Fixture",
        rating: "4.0",
        date: "2026. 7. 2.",
        nickname: "fixture"
      }),
      contract
    ),
    contract,
    {
      asOfDate: "2026-07-29",
      startIndex: 0,
      previousOldestPublishedDate: null
    }
  );

  expect(result).toMatchObject({
    status: "OK",
    newestPublishedDate: "2026-07-02",
    oldestPublishedDate: "2026-07-02"
  });
  if (result.status === "OK") {
    expect(result.reviews[0]?.publishedDate).toBe("2026-07-02");
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run apps/worker/src/reviews/extract-review-page.test.ts
```

Expected: the new test fails because dotted text currently returns `STOP_PROVIDER` with `DOM_CONTRACT_CHANGED`; existing tests remain green.

- [ ] **Step 3: Add invalid calendar and unsupported-format tests**

Add a table-driven test:

```ts
it.each([
  "2026. 2. 30.",
  "2026/07/02",
  "2026년 7월 2일",
  "26. 7. 2.",
  "2026. 7. 2. 12:00",
  "어제"
])("fails closed for unsupported provider date %s", async (date) => {
  const result = await extractReviewPage(
    fakePageFromHtml(
      oneReviewHtml({
        body: "Fixture",
        rating: "4.0",
        date,
        nickname: "fixture"
      }),
      contract
    ),
    contract,
    {
      asOfDate: "2026-07-29",
      startIndex: 0,
      previousOldestPublishedDate: null
    }
  );

  expect(result).toEqual({
    status: "STOP_PROVIDER",
    reasonCode: "DOM_CONTRACT_CHANGED"
  });
});
```

- [ ] **Step 4: Implement the minimal provider-date normalizer**

Add an internal function without exporting it:

```ts
function normalizeReviewPublishedDate(
  value: string
): string | null {
  const normalized = value.normalize("NFKC").trim();
  if (parseIsoDate(normalized) !== null) {
    return normalized;
  }
  const match =
    /^(?<year>\d{4})\.\s*(?<month>\d{1,2})\.\s*(?<day>\d{1,2})\.?$/u.exec(
      normalized
    );
  if (
    match?.groups?.year === undefined ||
    match.groups.month === undefined ||
    match.groups.day === undefined
  ) {
    return null;
  }
  const candidate = `${match.groups.year}-${match.groups.month.padStart(
    2,
    "0"
  )}-${match.groups.day.padStart(2, "0")}`;
  return parseIsoDate(candidate) === null ? null : candidate;
}
```

In `extractReviewPage()`, normalize `publishedDate.value` before `parseIsoDate()` and store only the normalized ISO value:

```ts
const normalizedPublishedDate =
  normalizeReviewPublishedDate(publishedDate.value);
const publishedAt =
  normalizedPublishedDate === null
    ? null
    : parseIsoDate(normalizedPublishedDate);
```

Use `normalizedPublishedDate` for `newestPublishedDate`, `oldestPublishedDate`, and `reviews[].publishedDate`. Do not change `parseIsoDate()`, `asOfDate`, or checkpoint parsing.

- [ ] **Step 5: Run extraction tests and verify GREEN**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run apps/worker/src/reviews/extract-review-page.test.ts
```

Expected: all extraction tests pass, including dotted conversion, invalid calendar rejection, ISO regression, cutoff, order, and pagination.

- [ ] **Step 6: Run direct Feature 4 regressions**

Run:

```powershell
corepack pnpm test:reviews:year-sync
corepack pnpm --filter @bread-map/worker typecheck
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit the date compatibility implementation**

```powershell
git add apps/worker/src/reviews/extract-review-page.ts apps/worker/src/reviews/extract-review-page.test.ts
git diff --cached --check
git commit -m "fix(worker): normalize Kakao review dates"
```

---

### Task 2: Generate and Validate the Sanitized Live Selector Contract

**Files:**
- Create locally, ignored: `C:\MinHyeok\Bread_map\var\kakao-review-selector-v2.json`
- Modify locally, ignored: `C:\MinHyeok\Bread_map\.env.live`
- Reference only: `apps/worker/src/reviews/review-dom-contract.ts`
- Reference only: `apps/worker/src/commands/collect-reviews.ts`

**Interfaces:**
- Consumes: `ReviewDomContract`, `loadReviewDomContract(path)`, `readLiveReviewPage(...)`
- Produces: a local `kakao-review-dom-v2` JSON contract and `KAKAO_REVIEW_SELECTOR_CONTRACT_PATH` pointing to it

- [ ] **Step 1: Load `.env.live` without emitting values**

Parse the six exact assignment names from `C:\MinHyeok\Bread_map\.env.live`, reject duplicate or blank assignments, and report only presence, 32-byte key validity, key inequality, selector file existence, and contract version. Never echo an assignment line.

- [ ] **Step 2: Inspect one public logged-out Kakao place page**

Use one browser tab. Confirm only these count/status signals:

```text
allowed Kakao origin: true
login detected: false
CAPTCHA detected: false
access denial detected: false
review navigation candidate count: 1
```

Stop without writing a file if any stop signal appears.

- [ ] **Step 3: Derive contract selectors from structural attributes**

For each required field, prefer stable `data-*`, stable ID, or scoped class attributes observed in the actual DOM. Do not use review text, nickname text, place ID, place URL, positional selectors, or generated user identifiers.

The contract must satisfy:

```text
version = kakao-review-dom-v2
paginationMode = append or replace, proven by one controlled next action
reviewItem count >= 1
body count within every reviewItem = 1
publishedDate count within every reviewItem = 1
nickname count within every reviewItem = 1
rating count within every reviewItem = 0 or 1
nextButton count = 0 or 1
loginWall, captcha, accessDenial selectors are structurally grounded
```

If any provider-stop selector cannot be grounded without triggering or bypassing a prohibited state, do not create the contract and report `SELECTOR_STOP_STATE_UNCONFIRMED`.

- [ ] **Step 4: Prove pagination mode with one controlled action**

Record item count, perform exactly one next/more action, wait the fixed 3,000 ms, and record the new item count without reading text.

```text
new count > old count  -> append
new count replaces old -> replace
no unique next control -> DOM_END, no action
```

Stop immediately on external redirect, access denial, CAPTCHA, login, HTTP 401/403/429, or item-order uncertainty.

- [ ] **Step 5: Write the ignored contract and update `.env.live`**

Only after Steps 2–4 pass, serialize the contract to:

```text
C:\MinHyeok\Bread_map\var\kakao-review-selector-v2.json
```

Replace only the `KAKAO_REVIEW_SELECTOR_CONTRACT_PATH` assignment in `.env.live` with that absolute path. Do not modify or print the other five assignments.

- [ ] **Step 6: Validate loader and page extraction without persistence**

Load the contract with `loadReviewDomContract()`, run one memory-only live page extraction, and report only:

```text
contract version
provider status
review item count
has-next boolean
newest/oldest date presence booleans
```

Do not start `runReviewBatch()`, encrypt, persist, or advance a checkpoint.

---

### Task 3: Update Delivery Status, Run Full Verification, and Push Main

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-kakao-review-dom-date-compatibility-design.md`
- Modify: `docs/10-delivery/local-development.md`
- Modify: `docs/10-delivery/development-readiness-checklist.md`

**Interfaces:**
- Consumes: completed date normalizer and validated local selector contract
- Produces: accurate code/fixture/contract status without a live collection success claim

- [ ] **Step 1: Update status without claiming collection success**

Set the compatibility design status to:

```markdown
**상태:** 구현·자동 검증 완료, sanitized live selector contract 검증 결과는 local operator artifact로 관리, provider collection run 미실행
```

Document that dotted dates are normalized only at the provider extraction boundary and all other formats stop the provider.

- [ ] **Step 2: Run targeted and full verification**

```powershell
corepack pnpm test:reviews:feature4
corepack pnpm test:reviews:year-sync
corepack pnpm --filter @bread-map/worker discover:kakao:fixture
corepack pnpm --filter @bread-map/worker collect:reviews:fixture
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm db:check
git diff --check
```

Expected: every command exits 0 with no live network and fixture commands emit status/count summaries only.

- [ ] **Step 3: Recheck non-disclosure and local artifact boundaries**

Report counts only:

```text
populated tracked secret assignments = 0
tracked .env.live files = 0
tracked live selector contracts = 0
runtime SQLite/browser artifacts staged = 0
```

- [ ] **Step 4: Commit documentation**

```powershell
git add docs/superpowers/specs/2026-07-29-kakao-review-dom-date-compatibility-design.md docs/10-delivery/local-development.md docs/10-delivery/development-readiness-checklist.md
git diff --cached --check
git commit -m "docs(delivery): record Kakao DOM compatibility"
```

- [ ] **Step 5: Verify and fast-forward push**

```powershell
corepack pnpm test
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
git push origin HEAD:refs/heads/main
```

Expected: the test suite exits 0, `origin/main` is an ancestor of `HEAD`, and the push is a fast-forward.

- [ ] **Step 6: Stop at the final live gate**

Report:

```text
date compatibility: implemented and verified
selector contract: validated or exact blocker code
provider collection run: NOT_STARTED
raw DB live changes: 0
remaining gate: actual app quota, policy/permission, environment, explicit post-change operator approval
```

Do not execute discovery or review collection in this task.
