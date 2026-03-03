// Health check tests — verify all staging endpoints are responsive
const { describe, it } = require('node:test');
const assert = require('node:assert');
const config = require('./config');

async function checkHealth(name, endpoint) {
  const url = endpoint.base + endpoint.health;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout);

  try {
    const res = await fetch(url, { signal: controller.signal });
    assert.ok(res.ok, `${name} health check failed: ${res.status} ${res.statusText}`);
    return { name, status: 'pass', statusCode: res.status };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`${name} health check timed out after ${config.timeout}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

describe('Health Checks', () => {
  for (const [name, endpoint] of Object.entries(config.endpoints)) {
    it(`${name} is healthy`, { timeout: config.timeout }, async () => {
      await checkHealth(name, endpoint);
    });
  }
});
