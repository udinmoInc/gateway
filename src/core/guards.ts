import { ERROR_CODES, STATUS } from '../constants.js';
import type {
  EdgeGuard,
  EdgeGuardDecision,
  EdgeRequestContext,
} from '../types.js';
import type { IncomingMessage } from 'node:http';

function allowWith(
  headers: Record<string, string> | undefined,
  tags: Readonly<Record<string, string>> | undefined,
): EdgeGuardDecision {
  const hasHeaders = headers !== undefined && Object.keys(headers).length > 0;
  const hasTags = tags !== undefined && Object.keys(tags).length > 0;
  if (!hasHeaders && !hasTags) return { action: 'allow' };
  return {
    action: 'allow',
    ...(hasHeaders ? { headers } : {}),
    ...(hasTags ? { tags } : {}),
  };
}

type TagMatcher = string | readonly string[] | ((value: string) => boolean);

function tagMatches(actual: string, expected: TagMatcher): boolean {
  if (typeof expected === 'function') return expected(actual);
  if (typeof expected === 'string') return actual === expected;
  return expected.includes(actual);
}

/**
 * Sequential composition — every guard must allow. First deny wins;
 * allow-headers and allow-tags are merged and visible to subsequent
 * guards via `ctx.headers` / `ctx.tags`.
 */
export function composeGuards<TReq extends IncomingMessage = IncomingMessage>(
  ...guards: readonly EdgeGuard<TReq>[]
): EdgeGuard<TReq> {
  return {
    name: 'composeGuards',
    async evaluate(ctx) {
      let headers = { ...ctx.headers };
      let tags: Record<string, string> = { ...ctx.tags };
      for (const guard of guards) {
        const decision = await guard.evaluate({
          ...ctx,
          headers,
          tags,
        });
        if (decision.action === 'deny') return decision;
        if (decision.headers) Object.assign(headers, decision.headers);
        if (decision.tags) Object.assign(tags, decision.tags);
      }
      return allowWith(headers, tags);
    },
  };
}

/** Alias of composeGuards — all guards must pass. */
export const allOf = composeGuards;

/**
 * First guard to allow wins (short-circuits). If every guard denies,
 * the first deny response is returned.
 */
export function anyOf<TReq extends IncomingMessage = IncomingMessage>(
  ...guards: readonly EdgeGuard<TReq>[]
): EdgeGuard<TReq> {
  return {
    name: 'anyOf',
    async evaluate(ctx) {
      let firstDeny: EdgeGuardDecision | undefined;
      for (const guard of guards) {
        const decision = await guard.evaluate(ctx);
        if (decision.action === 'allow') return decision;
        firstDeny ??= decision;
      }
      return firstDeny ?? {
        action: 'deny',
        status: STATUS.unauthorized,
        code: ERROR_CODES.unauthorized,
        message: 'access denied',
      };
    },
  };
}

export interface RequireTagOptions {
  /** Deny status when the tag is missing/mismatched. Default 403. */
  status?: number;
  /** Deny error code. Default 'FORBIDDEN'. */
  code?: string;
  /** Deny message override. */
  message?: string;
}

/**
 * Tag guard — requires `ctx.tags[key]` to exist (and match `expected`
 * when provided: string, list, or predicate). Domain-free: works for
 * plan tiers, tenants, regions, feature flags, geo buckets, etc.
 */
export function requireTag<TReq extends IncomingMessage = IncomingMessage>(
  key: string,
  expected?: TagMatcher,
  options?: RequireTagOptions,
): EdgeGuard<TReq> {
  return {
    name: 'requireTag',
    evaluate(ctx: EdgeRequestContext<TReq>) {
      const actual = ctx.tags[key];
      const deny = (message: string): EdgeGuardDecision => ({
        action: 'deny',
        status: options?.status ?? STATUS.forbidden,
        code: options?.code ?? ERROR_CODES.forbidden,
        message: options?.message ?? message,
      });
      if (actual === undefined) {
        return deny(`missing required tag: ${key}`);
      }
      if (expected !== undefined && !tagMatches(actual, expected)) {
        return deny(`tag ${key} mismatch`);
      }
      return { action: 'allow' };
    },
  };
}

/**
 * Header guard — requires `headerName` on the incoming request.
 * With `expected`, the value must match (missing → 401, mismatch → 403).
 */
export function requireHeader<TReq extends IncomingMessage = IncomingMessage>(
  headerName: string,
  expected?: string | readonly string[],
): EdgeGuard<TReq> {
  const name = headerName.toLowerCase();
  const expectedList =
    expected === undefined ? undefined : Array.isArray(expected) ? expected : [expected];
  return {
    name: 'requireHeader',
    evaluate(ctx: EdgeRequestContext<TReq>) {
      const raw = ctx.req.headers[name];
      const present = Array.isArray(raw) ? raw.length > 0 : raw !== undefined;
      if (!present) {
        return {
          action: 'deny',
          status: STATUS.unauthorized,
          code: ERROR_CODES.unauthorized,
          message: `missing required header: ${name}`,
        };
      }
      if (expectedList !== undefined) {
        const actual = Array.isArray(raw) ? raw[0] : raw;
        if (actual === undefined || !expectedList.includes(actual)) {
          return {
            action: 'deny',
            status: STATUS.forbidden,
            code: ERROR_CODES.forbidden,
            message: `header ${name} mismatch`,
          };
        }
      }
      return { action: 'allow' };
    },
  };
}
