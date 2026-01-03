# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) documenting significant technical decisions made in the docker-lab project.

## What Are ADRs?

Architecture Decision Records capture the context, reasoning, and consequences of important technical choices. They serve as:

- **Historical documentation**: Understanding why decisions were made
- **Onboarding material**: Helping new contributors understand the architecture
- **Reference points**: Preventing re-litigation of settled decisions
- **Change tracking**: Showing how the project evolved over time

## How to Read Decisions

Each decision record follows a consistent structure:

1. **Title**: A short phrase describing the decision
2. **Date**: When the decision was made
3. **Status**: Current state of the decision
4. **Context**: The problem or situation that prompted the decision
5. **Decision**: What was chosen and why
6. **Alternatives Considered**: Other options that were evaluated
7. **Consequences**: Trade-offs and implications
8. **References**: Sources, research, and related materials

## Decision Statuses

| Status | Meaning |
|--------|---------|
| `proposed` | Under discussion, not yet accepted |
| `accepted` | Currently in effect |
| `deprecated` | No longer recommended, but may still exist in codebase |
| `superseded` | Replaced by a newer decision (link provided) |

## Numbering Scheme

Decisions are numbered sequentially: `NNNN-short-title.md`

- **0000-0099**: Foundation and infrastructure decisions
- **0100-0199**: Database and storage decisions
- **0200-0299**: Security decisions
- **0300-0399**: Operations and deployment decisions
- **0400-0499**: Project structure decisions
- **0500+**: Reserved for future categories

## Quick Reference

See [INDEX.md](INDEX.md) for a categorized list of all decisions.

## Contributing New Decisions

1. Copy `0000-template.md` to a new file with the next available number
2. Fill in all sections (do not remove sections; mark as "N/A" if not applicable)
3. Set status to `proposed`
4. Submit for review
5. Update `INDEX.md` when the decision is accepted

## Principles

These ADRs follow several guiding principles:

- **Immutability**: Once accepted, ADRs are not edited except to update status
- **Supersession over deletion**: Outdated decisions are superseded, not removed
- **Context preservation**: Capture the situation at the time of the decision
- **Honesty about trade-offs**: Document what we gave up, not just what we gained
