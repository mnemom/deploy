# Development Workflow

- NEVER commit directly to `main`. Always create a feature branch first.
- Branch protection is enabled — pushes to `main` will be rejected.
- Flow: feature branch → PR to main → merge → auto-deploy staging → approve → production
- Deploys are managed by the centralized orchestrator at github.com/mnemom/deploy
- If you accidentally started work on main, recover with:
  ```bash
  git checkout -b fix/your-description
  git push -u origin fix/your-description
  gh pr create --base main
  ```

## Deploy Guardrails

This repo IS the deploy orchestrator — changes here affect all deployments across all services.

### Allowed
- Check deploy status: `gh run list --repo mnemom/deploy --workflow deploy.yml --limit 5`
- Read workflow files and scripts for debugging
- Modify deploy scripts (confidence scoring, PR context) via feature branch + PR

### Not allowed
- Approve or trigger production deploys (enforced by GitHub environment protection)
- Roll back production without explicit human instruction
- Push directly to main — all changes must go through PRs
- Modify workflow files (`deploy.yml`, reusable workflows) without explicit human instruction — these affect every service's deployment pipeline
