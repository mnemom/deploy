// E2E test configuration for staging endpoints
module.exports = {
  endpoints: {
    gateway: {
      base: process.env.E2E_GATEWAY_URL || 'https://gateway-staging.mnemom.ai',
      health: '/health',
    },
    api: {
      base: process.env.E2E_API_URL || 'https://api-staging.mnemom.ai',
      health: '/health',
    },
    reputation: {
      base: process.env.E2E_REPUTATION_URL || 'https://reputation-staging.mnemom.ai',
      health: '/health',
    },
    risk: {
      base: process.env.E2E_RISK_URL || 'https://risk-staging.mnemom.ai',
      health: '/health',
    },
    prover: {
      base: process.env.E2E_PROVER_URL || 'https://mnemom--mnemom-prover-prover-service.modal.run',
      health: '/health',
    },
    website: {
      base: process.env.E2E_WEBSITE_URL || 'https://mnemom-staging.netlify.app',
      health: '/',
    },
  },
  timeout: 30000, // per-test timeout
  suiteTimeout: 300000, // 5 min total
};
