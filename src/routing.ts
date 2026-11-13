import { ERROR_CODES, STATUS } from './constants.js';
import type {
  EdgeGuard,
  EdgeGuardDecision,
  EdgeRequestContext,
  ProtectionProvider,
  RouteConfig,
} from './types.js';
import type { IncomingMessage } from 'node:http';

/** Anything `asProtection` accepts: a raw EdgeGuard or a ProtectionProvider. */
export type ProtectionSource<TReq extends IncomingMessage = IncomingMessage> =
  | EdgeGuard<TReq>
  | ProtectionProvider<TReq>;

/**
 * Normalize a ProtectionProvider (or pass an EdgeGuard through) into
 * an EdgeGuard. `tags`/`headers` from the provider map into trusted
 * guard outputs; client-sent copies are stripped upstream only when
 * the developer lists them in `stripHeaders`.
 */
export function providerToGuard<TReq extends IncomingMessage = IncomingMessage>(
  source: ProtectionSource<TReq>,
): EdgeGuard<TReq> {
  if ('evaluate' in source) return source;
  const provider = source;
  return {
    name: provider.name ?? 'protection',
    async evaluate(ctx: EdgeRequestContext<TReq>): Promise<EdgeGuardDecision> {
      const result = await provider.verify(ctx);
      if (!result.allow) {
        const headers = result.headers
          ? { ...result.headers }
          : undefined;
        return {
          action: 'deny',
          status: result.status ?? STATUS.unauthorized,
          code: result.code ?? ERROR_CODES.unauthorized,
          message: result.message ?? 'access denied',
          ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
        };
      }
      const headers = result.headers ? { ...result.headers } : undefined;
      const tags = result.tags ? { ...result.tags } : undefined;
      const hasHeaders = headers !== undefined && Object.keys(headers).length > 0;
      const hasTags = tags !== undefined && Object.keys(tags).length > 0;
      if (!hasHeaders && !hasTags) return { action: 'allow' };
      return {
        action: 'allow',
        ...(hasHeaders ? { headers } : {}),
        ...(hasTags ? { tags } : {}),
      };
    },
  };
}

function withGuard<TReq extends IncomingMessage>(
  route: RouteConfig<TReq>,
  guard: EdgeGuard<TReq>,
): RouteConfig<TReq> {
  return { ...route, guards: [guard, ...(route.guards ?? [])] };
}

/** Route-wrapper returned by `asProtection(provider)`. */
export interface ProtectionApplier<TReq extends IncomingMessage = IncomingMessage> {
  (route: RouteConfig<TReq>): RouteConfig<TReq>;
  (routes: readonly RouteConfig<TReq>[]): RouteConfig<TReq>[];
}

/**
 * Attach a protection provider/guard to routes — curried form:
 * `asProtection(provider)` returns a wrapper you spread over
 * `route(...)`/`group(...)` output; the two-argument form applies
 * immediately. The guard is prepended onto each route's `guards`
 * chain; the gateway config stays untouched.
 */
export function asProtection<TReq extends IncomingMessage = IncomingMessage>(
  source: ProtectionSource<TReq>,
): ProtectionApplier<TReq>;
export function asProtection<TReq extends IncomingMessage = IncomingMessage>(
  source: ProtectionSource<TReq>,
  routes: RouteConfig<TReq> | readonly RouteConfig<TReq>[],
): RouteConfig<TReq> | RouteConfig<TReq>[];
export function asProtection<TReq extends IncomingMessage = IncomingMessage>(
  source: ProtectionSource<TReq>,
  routes?: RouteConfig<TReq> | readonly RouteConfig<TReq>[],
): ProtectionApplier<TReq> | RouteConfig<TReq> | RouteConfig<TReq>[] {
  const guard = providerToGuard(source);
  const apply = (
    input: RouteConfig<TReq> | readonly RouteConfig<TReq>[],
  ): RouteConfig<TReq> | RouteConfig<TReq>[] => {
    if (Array.isArray(input)) {
      return (input as readonly RouteConfig<TReq>[]).map((r) => withGuard(r, guard));
    }
    return withGuard(input as RouteConfig<TReq>, guard);
  };
  if (routes === undefined) {
    return apply as ProtectionApplier<TReq>;
  }
  return apply(routes);
}
