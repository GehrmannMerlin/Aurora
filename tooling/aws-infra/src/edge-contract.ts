/**
 * OPS-04 edge / DNS / TLS boundary contract (ADR-024, accepted 2026-08-11).
 *
 * This is a CONTRACT module, not a resource stack: production/staging domain
 * values are user-owned (D4/D5/D6) and must be provided before any real
 * CloudFront/ALB/Route 53/ACM resource is created (OPS-05). Every public entry
 * (CloudFront/ALB, including the ingestion public host) must be HTTPS only,
 * TLS >=1.2 (prefer 1.3), and carry WAF + rate limiting.
 *
 * `validateEdgeContract` validates untrusted input (`EdgeContractInput`) into a
 * frozen, typed `EdgeContract`; it throws stable errors on missing domain,
 * non-HTTPS, unsupported TLS or non-positive rate limits.
 */

export type TlsMinVersion = '1.2' | '1.3';

export interface EdgeContractInput {
  readonly domainName: string | undefined;
  readonly httpsOnly: boolean;
  readonly tlsMinVersion: string;
  readonly wafRateLimitRps: number;
}

export interface EdgeContract {
  readonly domainName: string;
  readonly httpsOnly: true;
  readonly tlsMinVersion: TlsMinVersion;
  readonly wafRateLimitRps: number;
}

export function validateEdgeContract(input: EdgeContractInput): EdgeContract {
  if (input.domainName === undefined || input.domainName.trim() === '') {
    throw new Error(
      'edge_domain_required: production/staging domain value must be provided by the domain owner before provisioning edge resources',
    );
  }
  if (!input.httpsOnly) {
    throw new Error('edge_https_required: public entries must be HTTPS only');
  }
  if (input.tlsMinVersion !== '1.2' && input.tlsMinVersion !== '1.3') {
    throw new Error('edge_tls_invalid: tlsMinVersion must be "1.2" or "1.3"');
  }
  if (!Number.isInteger(input.wafRateLimitRps) || input.wafRateLimitRps <= 0) {
    throw new Error('edge_waf_rate_invalid: wafRateLimitRps must be a positive integer');
  }
  return Object.freeze({
    domainName: input.domainName.trim(),
    httpsOnly: true,
    tlsMinVersion: input.tlsMinVersion,
    wafRateLimitRps: input.wafRateLimitRps,
  });
}
