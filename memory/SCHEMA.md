# Total Recall Memory Schema

> Protocol documentation. Loaded every session to guide memory operations.

## Four-Tier Architecture

```
CLAUDE.local.md          ← Working memory (auto-loaded, ~1500 words)
memory/registers/        ← Domain registers (load on demand)
memory/daily/            ← Daily logs (append-only, chronological)
memory/archive/          ← Completed/superseded items (cold storage)
```

### Tier 1: Working Memory (CLAUDE.local.md)
- Auto-loaded every session
- Contains only behavior-changing facts
- ~1500 word limit — prune aggressively
- Summary of active context, decisions, preferences, open loops

### Tier 2: Registers (memory/registers/)
- Loaded on demand based on topic
- Domain-specific: people, projects, decisions, preferences, tech-stack, open-loops
- More detailed than working memory
- See _index.md for routing rules

### Tier 3: Daily Logs (memory/daily/)
- Append-only chronological record
- First destination for new information
- Format: YYYY-MM-DD.md
- Promoted to registers after proving durable

### Tier 4: Archive (memory/archive/)
- Cold storage for completed projects and old daily logs
- Searchable but not auto-loaded
- Move items here when they no longer affect future behavior

## Write Gate Rules

Before writing anything, ask: **Does this change future behavior?**

- YES → Write to daily log first, then promote if durable
- NO → Do not write (avoid noise)

Examples of write-worthy info:
- User preferences ("always use tabs, not spaces")
- Decisions with rationale
- Project state changes
- Commitments and deadlines
- People context that affects collaboration

Examples of non-write-worthy:
- One-off facts with no future relevance
- Information already captured elsewhere
- Temporary states that will change immediately

## Read Rules

**Auto-loaded (every session):**
- CLAUDE.local.md (working memory)
- .claude/rules/total-recall.md (this protocol)

**On-demand (load when relevant):**
- memory/registers/ files (see _index.md for routing)
- memory/daily/[date].md (when reviewing recent history)

**Cold storage (search only):**
- memory/archive/ (when explicitly searching history)

## Routing Table

| Trigger | Destination |
|---------|-------------|
| Person mentioned by name | people.md register |
| Project discussed | projects.md register |
| Decision being made or questioned | decisions.md register |
| User states a preference | preferences.md register |
| Tech choices, tools, frameworks | tech-stack.md register |
| Follow-up needed, deadline set | open-loops.md register |
| Any new information | daily log first |

## Contradiction Protocol

**Never silently overwrite existing memory.**

When new info contradicts existing memory:
1. Note the contradiction explicitly
2. Mark old entry as superseded: `~~old info~~ (superseded YYYY-MM-DD)`
3. Add new entry with date
4. Update working memory if it contained the old info

## Correction Handling

When user corrects the AI:
1. Highest priority — immediately update all affected tiers
2. Write correction to daily log
3. Update relevant register
4. Update working memory if affected
5. Propagate to archive if the error appears there

## Maintenance Cadences

**Immediate:** Write to daily log when behavior-changing info appears

**End of session:**
- Review today's daily log
- Promote durable entries to registers
- Update working memory summary

**Periodic (weekly):**
- Prune working memory to stay under 1500 words
- Move resolved open loops to archive

**Quarterly:**
- Archive old daily logs (>90 days)
- Archive completed projects
- Review and prune registers

## File Locations

- Working memory: `CLAUDE.local.md` (project root, auto-loaded, gitignored)
- Protocol: `.claude/rules/total-recall.md` (auto-loaded)
- Registers: `memory/registers/`
- Daily logs: `memory/daily/YYYY-MM-DD.md`
- Archive: `memory/archive/`
