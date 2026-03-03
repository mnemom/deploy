# ADR 002: Tiered Deployment Pipeline

## Status
Accepted

## Context
Our services have npm package dependencies between them. Deploying all services simultaneously could result in a service running with an outdated SDK version that doesn't match the API it calls.

## Decision
We organized the deploy pipeline into dependency-ordered tiers:

**Staging Phase (auto, no approval)**
- Tier 1: Core services (gateway, observer, api, reputation, risk, prover) — parallel
- Tier 2: Consumers (website) — after services

**Production Phase (requires manual approval)**
- Tier 0: SDK packages (mnemom-types, aap, aip, otel-exporter, policy-engine, reputation-sdk, risk-sdk) — parallel
- Tier 1: Services (gateway, observer, api, reputation, risk, prover) — after packages
- Tier 2: Consumers (website, cli, hunter) — after services

Each tier waits for the previous tier to complete before starting.

## Consequences
- Full deploy takes longer due to serialization
- SDK version mismatches are prevented
- A failure in an early tier blocks later tiers (desired behavior)
- The pipeline supports deploying individual repos or "all"
