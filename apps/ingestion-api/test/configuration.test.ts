import { describe, expect, it } from 'vitest';
import { loadIngestionApiConfig } from '../src/configuration.js';

const validEnv = {
  HOST: '127.0.0.1',
  PORT: '8080',
  REQUEST_BODY_LIMIT_BYTES: '1048576',
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: '5000',
  DATABASE_URL: 'postgresql://localhost/db',
  LOG_ENABLED: 'true',
  LOG_LEVEL: 'warn',
};

describe('loadIngestionApiConfig', () => {
  it('freezes a typed config from valid environment strings', () => {
    const config = loadIngestionApiConfig(validEnv);
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8080);
    expect(config.requestBodyLimitBytes).toBe(1048576);
    expect(config.gracefulShutdownTimeoutMs).toBe(5000);
    expect(config.databaseUrl).toBe('postgresql://localhost/db');
    expect(config.logEnabled).toBe(true);
    expect(config.logLevel).toBe('warn');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('defaults logEnabled to false and logLevel to info when absent', () => {
    const config = loadIngestionApiConfig({
      HOST: '127.0.0.1',
      PORT: '8080',
      REQUEST_BODY_LIMIT_BYTES: '1024',
      GRACEFUL_SHUTDOWN_TIMEOUT_MS: '1000',
      DATABASE_URL: 'postgresql://localhost/db',
    });
    expect(config.logEnabled).toBe(false);
    expect(config.logLevel).toBe('info');
  });

  it('fails startup when requestBodyLimitBytes is missing', () => {
    expect(() =>
      loadIngestionApiConfig({
        HOST: '127.0.0.1',
        PORT: '8080',
        GRACEFUL_SHUTDOWN_TIMEOUT_MS: '1000',
        DATABASE_URL: 'postgresql://localhost/db',
      }),
    ).toThrow(/requestBodyLimitBytes|REQUEST_BODY_LIMIT_BYTES/i);
  });

  it('fails startup on an invalid port', () => {
    expect(() => loadIngestionApiConfig({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('fails startup on a non-positive body limit', () => {
    expect(() => loadIngestionApiConfig({ ...validEnv, REQUEST_BODY_LIMIT_BYTES: '0' })).toThrow(
      /REQUEST_BODY_LIMIT_BYTES/,
    );
  });

  it('fails startup on an invalid boolean', () => {
    expect(() => loadIngestionApiConfig({ ...validEnv, LOG_ENABLED: 'yes' })).toThrow(
      /LOG_ENABLED/,
    );
  });
});
