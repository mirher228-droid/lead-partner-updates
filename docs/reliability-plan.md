# Common panel reliability work

Baseline: `0cdd091e417268cfe1bd5df7a00ab71d9e23ad93`, Common 1.2.50.
The owner authorized fixes with the existing interface preserved. No employee
release, version/identity change, production CRM call, or environment publication.
Pre-existing updater changes are outside this work and must remain intact.

## Selected approach

Use small changes to the existing panel, controller and background journal.
A rewrite would change too many working CRM assumptions at once. Cosmetic UI
changes do not address uncertain writes or competing browser tabs.

## Ordered outcomes and ownership

1. `leadchat-request-controller.js`, `leadchat-request-background.js`: connect
   ordinary saves to the existing durable single-writer gate. A competing tab
   must not send another mutation, and uncertain writes must remain blocked.
   Preserve explicit new-request cycles and safe preflight retry.
2. `leadchat-request-panel.js`: retain unresolved operation IDs across failures,
   dialog switches and reload; restore read-only reconciliation controls.
   Clear operations only after an independently confirmed result or safe refusal.
3. `leadchat-crm-service.js`: key timetable responses by visit time as well as
   base/city/date. Equal requests should still share the existing short cache.
4. `avito-source-catalog.js`: a delayed initial storage read must not overwrite
   a newer validated catalogue notification.
5. `leadchat-request-host.js`: stop recurring DOM work while a tab is hidden,
   then resynchronize when it becomes visible. Preserve route and iframe checks.
6. Add dependency-free regression tests using Node's built-in test runner,
   integrate portable tests into cloud CI, and record the actual audit coverage,
   before/after evidence, compatibility limits and manual acceptance scenarios.

## Verification

Each fix starts with a failing behavioral reproduction against production code.
Use synthetic fixtures and mocked HTTP/storage/browser boundaries, never real
customer data. Run the full new Node suite, existing Python packaging tests and
deterministic build. Check the final diff against the original dirty working
tree. Exercise browser mounting where feasible. Offline tests cannot establish
live CRM compatibility, actual employee deployment, or Windows updater behavior.
Release remains a separate explicit instruction after review and acceptance.

## Extended reliability phase

The owner requested continued detailed work and a minimum five-hour duration.
Preserve the first phase and its regression cases. The next outcomes are:

1. Bound idle controller contexts at 64 with pending async operations pinned;
   preserve durable receipts, submitted drafts and uncertain operation journals.
2. Suppress hidden subscription/layout work while invalidating stale actions
   immediately, and coalesce visible geometry updates.
3. Order draft restoration behind outstanding writes for that same dialog;
   prevent late reads and context messages from reviving a destroyed mount.
4. Treat ambiguous HTTP/gateway outcomes after dispatch as uncertain; prevent
   stale service preparation responses from replacing a newer form generation.
5. Preserve legitimate catalogue endpoint changes and fail closed on collapsed
   map boundary geometry, with focused regression tests.
6. Run an actual elapsed-time, offline five-hour soak on a stable source
   fingerprint, using real browser DOM and synthetic data. Short smoke runs are
   preparation only. Record interruptions and failures as such; never relabel a
   short test or simulated time as five completed hours. Check ordinary suites
   and the deterministic package again after final source changes.

Runtime and resource bounds must be measured against a fixed live synthetic
dataset so fixture growth is not mistaken for extension memory leakage. The
soak must block external requests and produce atomic machine-readable progress
and a final report. No release, push or environment publication is authorized.

Extended phase completed: see docs/reliability-extended-validation.md for final evidence.
