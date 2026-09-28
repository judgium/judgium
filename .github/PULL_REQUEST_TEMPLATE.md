## What this changes

<!-- One or two sentences. If it fixes an issue: "Fixes #123". -->

## Why

<!-- The problem, ideally the one an organizer or judge actually hit. If there
     is an issue with the discussion, linking it is enough. -->

## How I verified it

<!-- The commands you ran and what you saw. For anything visual, a before/after
     screenshot. For anything operational, the exact commands. -->

```
npm test
```

---

## Checklist

- [ ] **Every commit is signed off** (`git commit -s`) — see below
- [ ] `npm test` passes locally
- [ ] A bug fix comes with a test that **fails before this change and passes after**
- [ ] New i18n keys are in **all five** locale files with identical `{placeholders}`
- [ ] Any change to an **existing** table is a new appended entry in `src/db/migrations.js`, not an edit to `schema.sql` or to a migration that has shipped
- [ ] No new runtime dependency (or it was agreed in an issue first)
- [ ] The frontend builds DOM nodes rather than assigning `innerHTML`
- [ ] Docs updated if behaviour, configuration or the API changed
- [ ] No judge tokens, secrets or real participant data anywhere in this PR

## Sign-off (DCO)

Judgium uses the [DCO](../blob/main/DCO) rather than a CLA: **you keep the
copyright in your contribution** and licence it to everyone under AGPL-3.0.
There is no copyright assignment, and no ability for the project to relicense
your code later.

Every commit needs the trailer, not just the last one:

```bash
git commit -s -m "..."                      # going forward
git commit --amend -s --no-edit             # fix the last commit
git rebase --signoff main                   # fix the whole branch
git config --global format.signoff true     # never think about it again
```

CI checks this. The name and e-mail must match your commit author identity.

- [ ] I have read [`CONTRIBUTING.md`](../blob/main/CONTRIBUTING.md) and agree to the [`DCO`](../blob/main/DCO)

<!-- Security fixes: please don't open a PR. Use private reporting —
     https://github.com/judgium/judgium/security/advisories/new -->
