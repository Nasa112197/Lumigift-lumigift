# Accessibility & Localization Requirements

> **Issue #155** — Testable requirements for supported languages, currencies,
> date formats, contrast levels, assistive-technology targets, and translation
> key conventions.
>
> Status: **Active** | Last updated: 2026-09-29

---

## Contents

1. [Supported Languages](#1-supported-languages)
2. [Supported Currencies & Number Formats](#2-supported-currencies--number-formats)
3. [Date & Time Formats](#3-date--time-formats)
4. [Colour Contrast Requirements](#4-colour-contrast-requirements)
5. [Assistive Technology Targets](#5-assistive-technology-targets)
6. [Translation Key Conventions](#6-translation-key-conventions)
7. [Acceptance Criteria Summary](#7-acceptance-criteria-summary)

---

## 1. Supported Languages

Lumigift targets Nigerian users as its primary audience. The following languages
are in scope:

| Code | Language | Priority | Notes |
|------|----------|----------|-------|
| `en` | English | P0 — required at launch | Default locale; all UI currently in English |
| `yo` | Yoruba | P1 — post-launch | High speaker count in SW Nigeria |
| `ig` | Igbo | P1 — post-launch | High speaker count in SE Nigeria |
| `ha` | Hausa | P1 — post-launch | Dominant in N Nigeria |

**Implementation approach:**
- All critical user-facing copy must use translation keys (see §6) even before
  non-English languages are shipped. This prevents hard-coded strings blocking
  later localisation work.
- The initial build ships `en` only. Language switching will be added via the
  `next-intl` integration path once P1 locales are ready.

### AC-LANG-1
> All visible user-facing text is sourced from a translation file
> (`messages/en.json` or equivalent), not hard-coded in component JSX.
> *Testable by:* running `grep -rn ">[A-Z]"` on `.tsx` files and verifying no
> bare sentence strings remain outside translation call sites.

### AC-LANG-2
> The `<html lang="...">` attribute correctly reflects the active locale.
> *Testable by:* axe-core rule `html-has-lang` passes in CI.

---

## 2. Supported Currencies & Number Formats

| Currency | Code | Use | Formatting | Example |
|----------|------|-----|-----------|---------|
| Nigerian Naira | `NGN` | User-facing input amounts | `₦1,500.00` (comma thousands, dot decimal) | ₦50,000.00 |
| USDC (Stellar) | `USDC` | On-chain / smart contract amounts | `50.00 USDC` (no symbol prefix) | 50.00 USDC |

**Rules:**
- Never display raw USDC amounts to users without the `USDC` suffix to avoid
  confusion with Naira.
- Always show NGN with the `₦` prefix.
- Amounts must use the `Intl.NumberFormat` API with `locale: 'en-NG'` for
  thousand-separator formatting (not hand-rolled string manipulation).

### AC-CURR-1
> All monetary amounts rendered in the UI use `Intl.NumberFormat` (or a
> wrapper that calls it) — never raw `toFixed()` or string concatenation for
> locale-sensitive formatting.
> *Testable by:* code search for `.toFixed(` in component files; any hit must
> be justified in a code comment.

### AC-CURR-2
> USDC and NGN amounts are never displayed without their currency identifier
> (`₦` or `USDC`).
> *Testable by:* design review of every screen that shows a monetary value.

---

## 3. Date & Time Formats

| Context | Format | Example | Notes |
|---------|--------|---------|-------|
| UI display (Nigerian users) | `DD/MM/YYYY` | 14/02/2025 | Matches Nigerian common convention |
| UI display with time | `DD/MM/YYYY HH:mm` | 14/02/2025 23:59 | 24-hour clock |
| API request/response | ISO 8601 | `2025-02-14T23:59:00Z` | UTC, always with `Z` suffix |
| Database storage | `TIMESTAMPTZ` | — | PostgreSQL UTC with timezone |
| Unlock date shown to sender | `DD MMM YYYY` | 14 Feb 2025 | Long-form month for clarity |
| Relative time (e.g. dashboard) | "in 3 days", "2 hours ago" | — | Computed from UTC, localised to device timezone |

**Rules:**
- All date rendering uses `src/lib/dateFormat.ts` helpers. No inline
  `new Date().toLocaleDateString()` calls allowed in components.
- API payloads always use ISO 8601 UTC strings.
- The user's local timezone (from browser) is used for display only — internal
  unlock logic uses UTC epoch timestamps.

### AC-DATE-1
> All component-level date formatting calls go through `src/lib/dateFormat.ts`.
> *Testable by:* code search for `new Date(` and `.toLocaleDateString(` in
> component files. Any hit outside `dateFormat.ts` must be justified.

### AC-DATE-2
> Date input fields (e.g. unlock date picker) include a visible format hint
> (`DD/MM/YYYY`) in the label or placeholder.
> *Testable by:* axe-core + manual review of the GiftWizard date step.

---

## 4. Colour Contrast Requirements

Lumigift must meet **WCAG 2.1 Level AA** as a minimum across all screens.
The critical payment and claim flows must meet **Level AAA** where feasible.

| Element type | Minimum contrast ratio | Standard |
|-------------|----------------------|---------|
| Normal text (< 18pt) | 4.5 : 1 | WCAG 2.1 AA |
| Large text (≥ 18pt or ≥ 14pt bold) | 3 : 1 | WCAG 2.1 AA |
| UI components & graphical objects | 3 : 1 | WCAG 2.1 AA |
| Critical action labels (payment, claim) | 7 : 1 | WCAG 2.1 AAA |
| Error / warning messages | 4.5 : 1 | WCAG 2.1 AA |
| Placeholder text | 4.5 : 1 | WCAG 2.1 AA |

**Design token constraints (from `src/styles/tokens.css`):**
- `--color-text` on `--color-bg` must be ≥ 4.5 : 1 in both light and dark mode.
- `--color-primary` used as a button background must provide ≥ 4.5 : 1 against
  white button text (`--color-on-primary`).

### AC-CR-1
> All text/background colour combinations pass the relevant WCAG 2.1 AA ratio.
> *Testable by:* CI axe-core check (`npm run a11y`) must pass with zero
> `color-contrast` violations.

### AC-CR-2
> Dark-mode colour tokens satisfy the same contrast ratios as light mode.
> *Testable by:* axe-core run with `data-theme="dark"` on `<html>`.

### AC-CR-3
> Focus indicators have a contrast ratio of at least 3 : 1 against adjacent
> colours (WCAG 2.4.11 Level AA, WCAG 2.2).
> *Testable by:* manual keyboard-navigation review and axe-core `focus-visible`
> rule.

---

## 5. Assistive Technology Targets

The following screen reader / AT combinations are in scope for manual testing
before each major release:

| Platform | Screen Reader | Browser | Priority |
|----------|--------------|---------|----------|
| Windows | NVDA (latest) | Chrome (latest) | P0 |
| macOS | VoiceOver (built-in) | Safari (latest) | P0 |
| iOS | VoiceOver (built-in) | Safari (latest) | P0 |
| Android | TalkBack (built-in) | Chrome (latest) | P1 |

**Minimum interaction requirements for each target:**
- Complete the full gift send flow (phone → amount → date → payment) without a
  mouse using only keyboard / switch / screen reader.
- Receive meaningful announcements at every state change (form errors,
  loading states, success/failure outcomes).
- Navigate the dashboard gift list and read gift status without visual cues.

### AC-AT-1
> The gift send flow is fully operable by keyboard alone (Tab, Shift+Tab,
> Enter, Space, arrow keys).
> *Testable by:* `src/app/__tests__/keyboard-navigation.test.tsx` passes, plus
> manual NVDA walkthrough.

### AC-AT-2
> All interactive elements have a discernible accessible name (via `aria-label`,
> `aria-labelledby`, or visible `<label>`).
> *Testable by:* axe-core rule `button-name`, `label` pass in CI.

### AC-AT-3
> Dynamic content updates (unread notification count, error messages, loading
> complete) are announced via `aria-live` regions with appropriate politeness.
> *Testable by:* axe-core + manual VoiceOver test on dashboard and notification
> center.

### AC-AT-4
> The app ships a visible skip-link ("Skip to main content") that is the first
> focusable element on every page.
> *Testable by:* `src/app/__tests__/accessibility.test.tsx` passes + manual
> check.

---

## 6. Translation Key Conventions

Even before non-English locales are shipped, all critical copy must be
centralised under a consistent key hierarchy. This enables future i18n without
a refactor.

### Key structure

```
<namespace>.<component_or_page>.<element>
```

Examples:
```
gifts.wizard.step_amount_label       → "Amount (₦)"
gifts.wizard.step_date_hint          → "DD/MM/YYYY"
gifts.wizard.confirm_payment_notice  → "This action is irreversible."
gifts.card.status_pending            → "Pending unlock"
notifications.bell.aria_label        → "Notifications, {count} unread"
notifications.page.mark_all_read     → "Mark all as read"
errors.network.offline               → "You are offline. Please check your connection."
errors.payment.failed                → "Payment failed. Please try again."
auth.login.otp_placeholder           → "Enter your 6-digit code"
```

### Rules

1. **Namespace must match the feature domain** (`gifts`, `auth`, `notifications`,
   `errors`, `common`).
2. **All user-visible strings in critical flows** (auth, gift creation, payment,
   claim) must use keys. Static marketing copy (landing page hero text) may be
   hard-coded until P1 locales are needed.
3. **No concatenation of translated fragments** — use ICU message format for
   plurals and interpolations (e.g. `{count, plural, one {# notification} other {# notifications}}`).
4. **Keys must be snake_case**; namespaces dot-separated.
5. **Every key used in code must exist in `messages/en.json`** — the CI
   `typecheck` step will catch missing keys once the type-safe `useTranslations`
   hook is integrated.

### AC-I18N-1
> No bare sentence-case string literals appear in JSX for any of: gift wizard
> steps, payment flow, claim flow, auth screens, or error messages.
> *Testable by:* linting rule or manual grep for quoted strings > 10 chars in
> the relevant component directories.

### AC-I18N-2
> All dynamic strings involving counts or amounts use ICU plural/select format,
> not JavaScript string template literals.
> *Testable by:* code review gate on PRs touching localised copy.

---

## 7. Acceptance Criteria Summary

| ID | Requirement | How to test |
|----|------------|-------------|
| AC-LANG-1 | All UI copy from translation files | grep for bare strings in `.tsx` |
| AC-LANG-2 | `<html lang>` reflects active locale | axe-core `html-has-lang` |
| AC-CURR-1 | Monetary amounts use `Intl.NumberFormat` | code search for `.toFixed(` |
| AC-CURR-2 | All amounts show currency identifier | design review |
| AC-DATE-1 | Date formatting via `dateFormat.ts` | code search |
| AC-DATE-2 | Date inputs show format hint | axe-core + manual |
| AC-CR-1 | AA colour contrast for all text | axe-core `color-contrast` |
| AC-CR-2 | Dark-mode tokens also pass AA | axe-core with `data-theme="dark"` |
| AC-CR-3 | Focus indicators ≥ 3 : 1 | axe-core + manual |
| AC-AT-1 | Full keyboard operability | keyboard-navigation test + NVDA |
| AC-AT-2 | All elements have accessible names | axe-core `button-name`, `label` |
| AC-AT-3 | Dynamic updates use `aria-live` | axe-core + VoiceOver |
| AC-AT-4 | Skip-link present on every page | accessibility test + manual |
| AC-I18N-1 | No bare strings in critical flows | grep / lint |
| AC-I18N-2 | Counts/amounts use ICU format | code review |

---

*Related: [known-violations.md](known-violations.md) | [Issue #155](https://github.com/joekeyz8/Lumigift-lumigift/issues/155)*
