// Integration tests — verify service chain connectivity
const { describe, it } = require('node:test');
const assert = require('node:assert');
const config = require('./config');

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

describe('Integration Tests', () => {
  it('all services are reachable from a single origin', { timeout: config.timeout * 2 }, async () => {
    const services = ['gateway', 'api', 'reputation', 'risk'];
    const results = await Promise.allSettled(
      services.map(async (name) => {
        const endpoint = config.endpoints[name];
        const res = await fetchWithTimeout(endpoint.base + endpoint.health);
        return { name, status: res.status };
      })
    );

    const failures = results.filter(r => r.status === 'rejected');
    assert.strictEqual(failures.length, 0,
      `Services unreachable: ${failures.map(f => f.reason?.message).join(', ')}`);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        assert.strictEqual(result.value.status, 200,
          `${result.value.name} returned ${result.value.status}`);
      }
    }
  });

  it('website loads successfully', { timeout: config.timeout }, async () => {
    const endpoint = config.endpoints.website;
    const res = await fetchWithTimeout(endpoint.base + endpoint.health);
    assert.ok(res.ok, `Website returned ${res.status}`);
  });
});
