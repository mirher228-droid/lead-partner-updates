# Common extension cloud maintenance

**Goal:** Repair the existing common Avito panel from a phone while the office PC is off.
**Architecture:** Keep editable released sources in extension/, build offline with Python and Node, retain the existing Windows release validator. Cloud checks must not publish an employee update.
**Tech Stack:** Python 3, Node.js, PowerShell, GitHub Actions, Codex Cloud.

## Constraints
- Baseline is published Common 1.2.50, no pilot/Admin/native features.
- Preserve manifest identity and existing update channel.
- Never upload accounts, browser profiles, credentials or employee records.
- No live CRM writes or Telegram messages during checks.

## Execution
- [ ] Extract exact published sources and verify original inventory.
- [ ] Add portable deterministic packaging and syntax/resource checks.
- [ ] Add CI artifact build and phone instructions; retain independent release step.
- [ ] Verify package with existing Windows validator and updater tests.
- [ ] Publish repository changes and configure Codex Cloud environment.

## Review focus
Preserve source bytes; reject missing manifest resources; rebuild inventory after edits; no accidental stable releases; cloud setup must have no office-PC dependency.
