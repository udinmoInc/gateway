import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { HEADERS } from '../constants.js';
import type { ApiKeyGuardConfig, ApiKeyRecord, RouteConfig } from '../types.js';
import { getHeaderString } from '../utils/extractors.js';

/** SHA-256 hex digest of a raw API key — keys are never stored/compared raw. */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

export type ApiKeyAuthResult =
  | { ok: true; record: ApiKeyRecord }
  | { ok: false; reason: 'missing' | 'invalid' | 'expired' | 'forbidden' };

/**
 * Scoped API key guard. Extracts the raw key from the configured header,
 * hashes it, resolves via the provider, enforces expiry and route scopes,
 * and exposes per-key rate limit overrides.
 */
export class ApiKeyGuard {
  private readonly provider: ApiKeyGuardConfig['provider'];
  private readonly headerName: string;

  constructor(config: ApiKeyGuardConfig) {
    this.provider = config.provider;
    this.headerName = config.headerName ?? HEADERS.apiKeyHeader;
  }

  /** Returns the raw key if present on the request. */
  extractKey(req: IncomingMessage): string | undefined {
    const value = getHeaderString(req, this.headerName);
    return value && value.length > 0 ? value : undefined;
  }

  /**
   * Authenticate the request's API key against the route's required scopes.
   * Only invoked for routes that declare `requiredScopes`.
   */
  async authenticate<TReq extends IncomingMessage>(
    req: IncomingMessage,
    route: RouteConfig<TReq>,
  ): Promise<ApiKeyAuthResult> {
    const raw = this.extractKey(req);
    if (!raw) return { ok: false, reason: 'missing' };

    const record = await this.provider.resolveByHash(hashApiKey(raw));
    if (!record) return { ok: false, reason: 'invalid' };
    if (record.expiresAtMs !== undefined && record.expiresAtMs <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }

    const required = route.requiredScopes ?? [];
    if (required.length > 0) {
      const hasAll = required.every((scope) => record.scopes.includes(scope));
      if (!hasAll) return { ok: false, reason: 'forbidden' };
    }
    return { ok: true, record };
  }
}

