# Git workflow (both developers)

Commands are for **PowerShell** on Windows. Replace `a/` with `b/` if you are Dev B.

## One-time setup

```powershell
git config --global core.longpaths true
npm install -g pnpm@10.12.1        # or: corepack enable  (needs an admin terminal)
cd "C:\Demo Project"
pnpm install
Copy-Item .env.example .env
```

## Every day: start work

```powershell
cd "C:\Demo Project"
git checkout main
git pull
git checkout a/phase-2-chat-calculator      # your current task branch
git merge main                              # pick up Dev B's merged work
pnpm install                                # only if pnpm-lock.yaml changed
pnpm dev:a                                  # web :3000 + api :4000
```

## Save and push your work (to your branch)

```powershell
git status
git add -A
git commit -m "Short description of the change"
git push
```

First push of a brand-new branch: `git push -u origin a/<task-name>`.

## Start a new task branch

```powershell
git checkout main
git pull
git checkout -b a/<task-name>               # e.g. a/glb-model, a/rtl-polish
git push -u origin a/<task-name>
```

## Get your work into `main`

**Preferred: pull request (squash merge).** Push your branch, then on GitHub:
Pull requests → New → base `main` ← compare `a/<task-name>` → Create → wait for CI → **Squash and merge**.

With the GitHub CLI (`winget install GitHub.cli`, then `gh auth login` once):

```powershell
gh pr create --base main --fill
gh pr merge --squash --delete-branch       # after CI passes
```

**Direct (no PR).** Only works while `main` has no branch protection:

```powershell
git checkout main
git pull
git merge --squash a/<task-name>
git commit -m "Merge a/<task-name>: short summary"
git push
git checkout a/<task-name>
```

## Before every push to main, run the same checks as CI

```powershell
pnpm check:boundaries
pnpm typecheck
pnpm test
pnpm build
```

## Rules

- Never commit `.env` or real keys.
- `packages/contracts` or `assets/seed` changes need both developers' approval.
- If `git push` is rejected: `git pull --rebase`, fix any conflicts, then push again.
