# Accessibility — Known Acceptable Violations

This document records axe-core violations that are intentionally excluded from
the CI blocking check, along with justification and the ticket tracking the fix.

---

## nested-interactive — GiftCard claim view

| Field         | Value                                                                                                                                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID       | `nested-interactive`                                                                                                                                                                                                                                                                                           |
| Impact        | serious                                                                                                                                                                                                                                                                                                        |
| Component     | `src/components/gift/GiftCard.tsx`                                                                                                                                                                                                                                                                             |
| Description   | `ClaimButton` (renders a `<button>`) is a child of `<article role="button">`, creating nested interactive elements. Screen readers may not announce the inner button correctly, and keyboard focus order can be confusing.                                                                                     |
| Justification | Pre-existing structural issue in the GiftCard component. The outer `role="button"` navigates to the gift detail page; the inner `ClaimButton` triggers the claim flow. These two interactions need to be separated (e.g. remove `role="button"` from the article and use a dedicated navigation link instead). |
| Accepted      | 2026-04-24                                                                                                                                                                                                                                                                                                     |
| Fix tracked   | Refactor GiftCard to use `<a>` or `<Link>` for navigation instead of `role="button"` on the article element.                                                                                                                                                                                                   |

---

> **Policy:** Any new critical or serious axe violation must either be fixed
> before merging, or documented here with a justification and a linked ticket.
> Violations with impact `moderate` or `minor` are logged but do not block CI.

---

## Accessibility & Localization Requirements

Full testable requirements for contrast levels, assistive-technology targets,
supported languages, date formats, and translation key conventions are defined
in a separate document:

👉 **[a11y-localization-requirements.md](a11y-localization-requirements.md)**

That document supersedes any informal requirements previously described in this
file. When adding a new known violation, cross-reference the relevant
acceptance criteria from that requirements doc (e.g. `AC-CR-1`, `AC-AT-3`).

_Section added 2026-09-29 — Issue #155_

---

## Accessibility & Localization Requirements

Full testable requirements for contrast levels, assistive-technology targets,
supported languages, date formats, and translation key conventions are defined
in a separate document:

👉 **[a11y-localization-requirements.md](a11y-localization-requirements.md)**

That document supersedes any informal requirements previously described in this
file. When adding a new known violation, cross-reference the relevant
acceptance criteria from that requirements doc (e.g. `AC-CR-1`, `AC-AT-3`).

_Section added 2026-09-29 — Issue #155_
