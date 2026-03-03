# ADR 003: Deployment Confidence Scoring

## Status
Accepted

## Context
We wanted to give the human approver more information before they approve a production deploy. Raw CI pass/fail doesn't capture risk signals like change size, dependency updates, or time-since-last-deploy.

## Decision
We implemented a confidence scoring system (`scripts/confidence-score.js`) that computes a 0-100 score based on:

| Signal | Impact |
|--------|--------|
| Small change (<50 lines) | +10 |
| Large change (>500 lines) | -20 |
| Files outside src/ | -10 |
| Dependency changes | -15 |
| >3 services affected | -15 |
| 2-3 services affected | -5 |
| >7 days since last prod deploy | -5 |
| Open CodeQL alerts | -10 |
| Friday afternoon deploy | -15 |
| Weekend deploy | -10 |
| Late night deploy | -5 |

The score is posted to GitHub Step Summary for human review. It is informational only — it does not gate production.

## Consequences
- Humans get a quick risk assessment before approving
- Score is advisory, not blocking (avoids false-positive blocks)
- Requires GitHub API access to compute (diff stats, deployment history)
- Score can be manipulated by commit structure (splitting large changes)
