# Quickstart: Creating a New Plan

Create a structured plan in `plans/` using the template.

## Step 1: Determine Plan Scope

Before creating the plan, answer:
1. **What work needs to happen?** (Feature, refactor, migration, etc.)
2. **How many phases?** (1-2 = simple, 3+ = complex)
3. **Does it build on existing work?**

## Step 2: Create the Folder

```bash
mkdir -p plans/my-feature
```

## Step 3: Copy Templates

```bash
TEMPLATE_DIR="$HOME/.pi/agent/skills/planning/templates"
cp "$TEMPLATE_DIR"/*.md plans/my-feature/
mv plans/my-feature/TEMPLATE.md plans/my-feature/PLAN.md
```

## Step 4: Fill in PLAN.md

```markdown
# My Feature Plan

**Author:** [Your Name]
**Date:** YYYY-MM-DD
**Status:** Draft
**Version:** 1.0
```

Complete these sections:

| Section | What to Write |
|---------|--------------|
| Purpose | Why does this work exist? |
| Scope | In-scope (table) and out-of-scope |
| What Already Exists | Existing code to build on |
| Implementation Plan | Phases with dependencies |
| Phase Details | Tasks per phase, files to create/modify |
| Testing Strategy | What tests are needed |

## Step 5: Customize AGENT-PROMPT.md

Replace placeholders:

| Find | Replace With |
|------|-------------|
| `[PLAN NAME]` | Your plan name |
| `<plan-name>` | Your folder name |
| Context file paths | Real paths from your codebase |

## Step 6: Initialize PROGRESS.md

| Find | Replace With |
|------|-------------|
| `[Plan Name]` | Your plan name |
| Phase rows | Your actual phases |

## Step 7: Review and Approve

- [ ] All sections filled (no TODOs)
- [ ] Phase order is logical
- [ ] Each phase scope is clear and actionable
- [ ] File structure matches your plan

Update status from `Draft` to `Approved`.

## Executing a Plan

### User-Prompted Session

Prompt the agent with:
```
Execute the next phase of the my-feature plan.
PLAN_PATH: plans/my-feature/
```

The agent will:
1. Read `PROGRESS.md` to find next phase
2. Read `PLAN.md` for phase scope
3. Execute the phase
4. Run validation
5. Commit and update `PROGRESS.md`

### Programmatic Loop

Automated runner invokes the agent repeatedly until all phases are ✅.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Don't know phase count | Start coarse (Prereq, Phase 0, Phase 1). Split later. |
| Scope too large | Split into multiple plans |
| Phase depends on other work | Add note in Dependencies section |
