---
name: deep-research
description: >
  Conduct deep, multi-source research on any topic. Produces structured research reports
  with citations, key findings, contradictions, and synthesis. Use when: user asks for
  research, analysis, deep dive, investigation, literature review, competitive analysis,
  technology comparison, market research, or "look into" a topic. NOT for: simple factual
  lookups (use web_search directly), single-source reads (use web_fetch), or real-time
  data (prices, scores, weather).
---

# Deep Research

Perform thorough multi-source research with structured output.

## Workflow

### 1. Scoping

Clarify the research question. If ambiguous, ask 1-2 targeted questions. Otherwise proceed.

Determine research depth:
- **Quick** (3-5 sources): Surface-level scan, ~2 min
- **Standard** (5-10 sources): Balanced analysis, ~5 min
- **Deep** (10-20 sources): Comprehensive investigation, ~10+ min

Default to **Standard** unless user specifies.

### 2. Search Strategy

Generate 3-5 diverse search queries from different angles. Avoid near-duplicate queries.

Example for "best Python web frameworks 2026":
1. "Python web framework comparison 2026"
2. "FastAPI vs Django vs Flask performance benchmarks"
3. "Python web framework production adoption statistics"
4. "Python web framework developer survey satisfaction"

Use `web_search` with `count: 5-10` per query. Vary `freshness` when temporal relevance matters.

### 3. Source Extraction

For the most promising results (top 3-5 per query), use `web_fetch` to extract content.

Prioritize:
- Official docs, primary sources
- Peer-reviewed or well-cited analysis
- Recent content (check dates)
- Diverse perspectives (not all from same domain)

Skip: paywalled content, social media rants, thin affiliate sites.

### 4. Analysis

Cross-reference findings across sources. Identify:
- **Consensus points** — what most sources agree on
- **Contradictions** — where sources disagree (and why)
- **Gaps** — important aspects not covered
- **Key data points** — statistics, dates, quotes

### 5. Report Generation

Write report to `workspace/research/<topic-slug>.md`. Create `research/` if needed.

Use `scripts/generate_report.py` for consistent formatting, or write manually following the template in `references/output-format.md`.

Report structure:
```markdown
# Research: [Topic]
Date: YYYY-MM-DD | Depth: [Quick|Standard|Deep]

## Executive Summary
2-3 sentence overview of key findings.

## Key Findings
1. Finding — Source: [url]
2. Finding — Source: [url]

## Detailed Analysis
[Organized by subtopic or theme]

## Contradictions & Caveats
[Where sources disagree, limitations]

## Sources
| # | Title | URL | Date |
|---|-------|-----|------|
| 1 | ... | ... | ... |
```

### 6. Delivery

Send a concise summary to the user (3-5 bullet points). Link to full report file.

## Tips

- For technical topics, include code examples or architecture diagrams (mermaid) when relevant
- For competitive analysis, use comparison tables
- For trend analysis, include timeline of key events
- Save raw search results in the report's frontmatter for reproducibility
