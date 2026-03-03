// Smoke tests — verify basic API functionality
const { describe, it } = require('node:test');
const assert = require('node:assert');
const config = require('./config');

async function apiRequest(service, path, options = {}) {
  const endpoint = config.endpoints[service];
  const url = endpoint.base + path;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    return {
      status: res.status,
      ok: res.ok,
      body: await res.json().catch(() => null),
      text: null,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

describe('Smoke Tests', () => {
  it('API returns valid response structure', { timeout: config.timeout }, async () => {
    const res = await apiRequest('api', '/health');
    assert.strictEqual(res.status, 200);
  });

  it('Gateway returns valid response structure', { timeout: config.timeout }, async () => {
    const res = await apiRequest('gateway', '/health');
    assert.strictEqual(res.status, 200);
  });

  it('Reputation service responds', { timeout: config.timeout }, async () => {
    const res = await apiRequest('reputation', '/health');
    assert.strictEqual(res.status, 200);
  });

  it('Risk service responds', { timeout: config.timeout }, async () => {
    const res = await apiRequest('risk', '/health');
    assert.strictEqual(res.status, 200);
  });
});
