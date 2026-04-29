# Plan Quality Checklist

Use this checklist to review plans before approval and execution.

## Plan Document (PLAN.md)

### Header
- [ ] Author name filled in
- [ ] Date is current (YYYY-MM-DD)
- [ ] Status is correct (Draft/Review/Approved)
- [ ] Version is set to 1.0 for new plans

### Purpose
- [ ] Clear problem statement
- [ ] Explains why this work matters
- [ ] No implementation details (those go in scope)

### Scope
- [ ] In-scope items are clearly defined
- [ ] Out-of-scope items are explicit (prevents scope creep)
- [ ] Priorities assigned (P0/P1/P2)

### What Already Exists
- [ ] All existing components documented
- [ ] Locations are accurate (verify paths exist)
- [ ] Status indicators are current

### Implementation Plan
- [ ] Phase order is logical (dependencies respected)
- [ ] Each phase has clear deliverables
- [ ] Phase scopes don't overlap
- [ ] No phase is too large (>1 week of work)

### Phase Details (per phase)
- [ ] Scope items are checkable (not vague)
- [ ] Out-of-scope prevents gold-plating
- [ ] Files to modify are listed
- [ ] New files are named appropriately
- [ ] Context files to read are relevant

### File Structure
- [ ] All existing files are marked ✅
- [ ] Files to modify are marked 🔧
- [ ] New files are marked 🆕
- [ ] File locations are accurate

### Dependencies
- [ ] All dependent plans are referenced
- [ ] Dependency status is accurate (Ready/Blocked)

### Testing Strategy
- [ ] Unit tests defined
- [ ] Integration tests defined
- [ ] Smoke tests defined

### Related Documents
- [ ] Links to existing patterns
- [ ] Links to related plans

## Agent Prompt (AGENT-PROMPT.md)

### Phase Definitions
- [ ] All phases are defined
- [ ] Scope matches PLAN.md
- [ ] Out-of-scope matches PLAN.md
- [ ] No duplicate tasks across phases

### Context Files
- [ ] Paths are accurate (verify files exist)
- [ ] Enough context to execute without guessing
- [ ] Not overwhelming (focused on what's needed)

### Rules
- [ ] Follows AGENTS.md principles
- [ ] Clear about layering expectations
- [ ] Testing requirements explicit

### Commit Format
- [ ] Type choices make sense (feat/fix/docs/refactor)
- [ ] Scope is clear
- [ ] Bullet list format is repeatable

### Hard Stops
- [ ] Covers all critical failure modes
- [ ] Instructions to report, not hide problems

## Progress Tracking (PROGRESS.md)

### Phase Status
- [ ] All phases listed
- [ ] Status symbols are correct
- [ ] Phase descriptions match PLAN.md

### Initial State
- [ ] All phases show 🔲 (not started)
- [ ] Prereq is first if present

### Notes
- [ ] Plan version is current
- [ ] Any blocking issues documented

## README

### Index
- [ ] All documents listed
- [ ] Status matches actual status
- [ ] Version is current

### Scope
- [ ] Brief summary of what this plan covers
- [ ] Phase order matches PLAN.md

## General Quality

### Clarity
- [ ] Someone unfamiliar with the codebase could execute this
- [ ] No jargon unexplained
- [ ] Acronyms are expanded on first use

### Accuracy
- [ ] All file paths verified to exist
- [ ] All referenced plans exist
- [ ] No assumptions about future code

### Completeness
- [ ] Nothing is left as "TODO" or "TBD"
- [ ] All placeholder values replaced

### Feasibility
- [ ] Each phase is completable in reasonable time
- [ ] No phase requires too many files to understand
- [ ] Context loading is manageable

## Anti-Patterns to Avoid

| Anti-Pattern | Why It's Bad | Fix |
|--------------|--------------|-----|
| Vague scope | Agents guess, produce wrong output | Be specific |
| Overlapping phases | Duplicate work | Split clearly |
| Missing out-of-scope | Feature creep | List explicitly |
| No testing strategy | Unverified code | Define tests |
| Huge single phase | Can't track progress | Split |
| Missing context | Agent wastes time | List files |
| Unverified file paths | 404 errors during execution | Check paths |

## Sign-Off

Before marking a plan as **Approved**:

- [ ] Author has reviewed all sections
- [ ] At least one other person has reviewed (if possible)
- [ ] File paths have been verified
- [ ] Dependencies are resolved or noted
- [ ] Status updated from Draft to Approved
