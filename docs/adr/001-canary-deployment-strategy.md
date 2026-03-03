# ADR 001: Canary Deployment Strategy

## Status
Accepted

## Context
We needed a safe way to deploy Cloudflare Workers to production without risking full traffic disruption. Workers don't natively support canary deployments through traffic splitting at the DNS or load balancer level.

## Decision
We implemented canary deployments using Cloudflare's Gradual Rollouts feature:
1. Deploy new version as a canary (uploaded but not activated for all traffic)
2. Use Cloudflare Workers versioned deployments to split traffic (configurable percentage)
3. Monitor error rates via Cloudflare GraphQL Analytics API
4. Auto-rollback if error rate exceeds threshold
5. Full promotion after monitoring period passes

The implementation lives in `deploy-cloudflare-worker-canary.yml` with support scripts:
- `check-error-rate.js`: Queries CF GraphQL Analytics for error rate
- `post-deploy-monitor.js`: 5-minute monitoring loop that auto-dispatches rollback

## Consequences
- Production deploys take ~7 minutes (vs ~30s for direct deploy)
- Requires Cloudflare API token with Workers Scripts permissions
- Rollback is automatic but recovery takes ~1 minute
- Observer (cron worker) cannot use canary — uses direct deploy instead
