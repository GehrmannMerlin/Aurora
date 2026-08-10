import { describe, expect, it } from 'vitest';
import { IngestionInboxError } from '@aurora/ingestion-inbox';
import { IngestionCredentialsError } from '@aurora/ingestion-credentials';
import { ProcessingStoreError } from '@aurora/processing-store';
import { mapErrorToProblem } from '../src/error-mapper.js';

describe('mapErrorToProblem (stable data-layer errors)', () => {
  it('maps a ProcessingStoreError invalid_input to a 400 structural_error', () => {
    const mapped = mapErrorToProblem(
      'req-1',
      new ProcessingStoreError('invalid_input', 'malformed endpoint cursor'),
    );
    expect(mapped.status).toBe(400);
    expect(mapped.problem.code).toBe('structural_error');
    expect(mapped.problem.requestId).toBe('req-1');
    expect(mapped.problem.detail).toBe('Request does not match the public contract.');
  });

  it('maps a ProcessingStoreError database_unavailable to a 503 authority_unavailable', () => {
    const mapped = mapErrorToProblem(
      'req-2',
      new ProcessingStoreError('database_unavailable', 'authority unreachable'),
    );
    expect(mapped.status).toBe(503);
    expect(mapped.problem.code).toBe('authority_unavailable');
    expect(mapped.problem.requestId).toBe('req-2');
    expect(mapped.problem.detail).toBe('Authority is temporarily unavailable.');
  });

  it('maps a ProcessingStoreError statement_failed to a 503 authority_unavailable', () => {
    const mapped = mapErrorToProblem(
      'req-3',
      new ProcessingStoreError('statement_failed', 'request metric summary query failed'),
    );
    expect(mapped.status).toBe(503);
    expect(mapped.problem.code).toBe('authority_unavailable');
    expect(mapped.problem.requestId).toBe('req-3');
  });

  it('never surfaces the internal message or stack for a ProcessingStoreError', () => {
    const mapped = mapErrorToProblem(
      'req-4',
      new ProcessingStoreError('invalid_input', 'malformed endpoint cursor'),
    );
    const raw = JSON.stringify(mapped.problem);
    expect(raw).not.toContain('malformed endpoint cursor');
    expect(raw).not.toContain('ProcessingStoreError');
  });

  it('maps IngestionInboxError invalid_input to 400 structural_error', () => {
    const mapped = mapErrorToProblem('req-5', new IngestionInboxError('invalid_input', 'x'));
    expect(mapped.status).toBe(400);
    expect(mapped.problem.code).toBe('structural_error');
    expect(mapped.problem.requestId).toBe('req-5');
  });

  it('maps IngestionInboxError database_unavailable to 503 authority_unavailable', () => {
    const mapped = mapErrorToProblem('req-6', new IngestionInboxError('database_unavailable', 'x'));
    expect(mapped.status).toBe(503);
    expect(mapped.problem.code).toBe('authority_unavailable');
    expect(mapped.problem.detail).toBe('Authority is temporarily unavailable.');
  });

  it('maps IngestionCredentialsError statement_failed to 503 authority_unavailable', () => {
    const mapped = mapErrorToProblem(
      'req-7',
      new IngestionCredentialsError('statement_failed', 'x'),
    );
    expect(mapped.status).toBe(503);
    expect(mapped.problem.code).toBe('authority_unavailable');
  });

  it('maps IngestionCredentialsError database_unavailable to 503 authority_unavailable', () => {
    const mapped = mapErrorToProblem(
      'req-8',
      new IngestionCredentialsError('database_unavailable', 'x'),
    );
    expect(mapped.status).toBe(503);
    expect(mapped.problem.code).toBe('authority_unavailable');
    expect(mapped.problem.requestId).toBe('req-8');
  });

  it('never surfaces the internal message or class name for the two new stable errors', () => {
    const inbox = mapErrorToProblem('req-9', new IngestionInboxError('statement_failed', 'boom'));
    expect(JSON.stringify(inbox.problem)).not.toContain('boom');
    expect(JSON.stringify(inbox.problem)).not.toContain('IngestionInboxError');
    const creds = mapErrorToProblem(
      'req-10',
      new IngestionCredentialsError('invalid_input', 'boom'),
    );
    expect(JSON.stringify(creds.problem)).not.toContain('boom');
    expect(JSON.stringify(creds.problem)).not.toContain('IngestionCredentialsError');
  });
});
