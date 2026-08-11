import { describe, expect, it } from 'vitest';
import { validateEdgeContract } from '../src/edge-contract.js';

const valid = {
  domainName: 'app.aurora.example',
  httpsOnly: true,
  tlsMinVersion: '1.3',
  wafRateLimitRps: 1000,
};

describe('edge / DNS / TLS boundary contract', () => {
  it('accepts a valid contract and freezes it', () => {
    const contract = validateEdgeContract(valid);
    expect(contract.domainName).toBe('app.aurora.example');
    expect(contract.tlsMinVersion).toBe('1.3');
    expect(contract.httpsOnly).toBe(true);
    expect(Object.isFrozen(contract)).toBe(true);
  });

  it('throws edge_domain_required when the domain is missing', () => {
    expect(() => validateEdgeContract({ ...valid, domainName: undefined })).toThrow(
      'edge_domain_required',
    );
    expect(() => validateEdgeContract({ ...valid, domainName: '  ' })).toThrow(
      'edge_domain_required',
    );
  });

  it('throws edge_https_required when httpsOnly is false', () => {
    expect(() => validateEdgeContract({ ...valid, httpsOnly: false })).toThrow(
      'edge_https_required',
    );
  });

  it('throws edge_tls_invalid on an unsupported TLS minimum', () => {
    expect(() => validateEdgeContract({ ...valid, tlsMinVersion: '1.0' })).toThrow(
      'edge_tls_invalid',
    );
  });

  it('throws edge_waf_rate_invalid on non-positive rate limits', () => {
    expect(() => validateEdgeContract({ ...valid, wafRateLimitRps: 0 })).toThrow(
      'edge_waf_rate_invalid',
    );
    expect(() => validateEdgeContract({ ...valid, wafRateLimitRps: 100 })).not.toThrow();
  });
});
