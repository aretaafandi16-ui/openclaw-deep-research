#!/usr/bin/env python3
"""Generate a structured research report from findings data (JSON stdin)."""

import json
import sys
import os
from datetime import datetime

TEMPLATE = """# Research: {topic}
Date: {date} | Depth: {depth}
Sources analyzed: {source_count}

## Executive Summary
{summary}

## Key Findings
{findings}

## Detailed Analysis
{analysis}

## Contradictions & Caveats
{contradictions}

## Sources
{sources_table}
"""

def slugify(text):
    return text.lower().replace(' ', '-')[:60].strip('-')

def generate_report(data):
    topic = data.get('topic', 'Untitled Research')
    depth = data.get('depth', 'Standard')
    findings = data.get('findings', [])
    analysis = data.get('analysis', '')
    contradictions = data.get('contradictions', 'None identified.')
    sources = data.get('sources', [])
    summary = data.get('summary', '')

    findings_text = '\n'.join(
        f"{i+1}. **{f['finding']}** — Source: [{f.get('source_title', 'link')}]({f.get('source_url', '#')})"
        for i, f in enumerate(findings)
    ) if findings else 'No key findings extracted.'

    sources_table = '| # | Title | URL | Date |\n|---|-------|-----|------|\n'
    sources_table += '\n'.join(
        f"| {i+1} | {s.get('title','')} | {s.get('url','')} | {s.get('date','')} |"
        for i, s in enumerate(sources)
    ) if sources else '| - | No sources recorded | | |'

    report = TEMPLATE.format(
        topic=topic,
        date=datetime.now().strftime('%Y-%m-%d'),
        depth=depth,
        source_count=len(sources),
        summary=summary,
        findings=findings_text,
        analysis=analysis or 'See Key Findings above.',
        contradictions=contradictions,
        sources_table=sources_table
    )

    slug = slugify(topic)
    os.makedirs('research', exist_ok=True)
    path = f'research/{slug}.md'
    with open(path, 'w') as f:
        f.write(report)
    print(f"Report written to: {path}")
    return path

if __name__ == '__main__':
    data = json.load(sys.stdin)
    generate_report(data)
