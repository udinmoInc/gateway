import type { IncomingMessage } from 'node:http';
import { createGateway } from './core/GatewayEngine.js';
import type { Gateway, ShutdownOptions } from './core/GatewayEngine.js';
import { CircuitBreaker } from './core/CircuitBreaker.js';
import type { CircuitBreakerLike } from './core/CircuitBreaker.js';
import { RedisRateLimiter } from './limiter/RedisRateLimiter.js';
import { LocalFallback } from './limiter/LocalFallback.js';
import { Router } from './core/Router.js';
import { ProxyHandler } from './core/ProxyHandler.js';
import {
  extractApiKeyOrIp,
  extractClientIp,
  createCompositeExtractor,
  resolveExtractor,
  getHeaderString,
} from './utils/extractors.js';
import { sendJson, sendGatewayResponse, defaultErrorBody } from './utils/http.js';
import type {
  ApiKeyGuardConfig,
  ApiKeyProvider,
  ApiKeyRecord,
  AuthConfig,
  AuthOutcome,
  AuthProvider,
  Brand,
  IntrospectionProviderOptions,
  JwksProviderOptions,
  BruteForceConfig,
  CircuitBreakerOptions,
  CorsConfig,
  GatewayPlugin,
  GatewayStore,
  PluginContext,
  PolicyDecision,
  SecurityAuditEvent,
  SecurityEventType,
  SecurityHeadersConfig,
  UpstreamSigningConfig,
  CircuitState,
  ClientKeyExtractor,
  DefineRouteOptions,
  ErrorCode,
  FailMode,
  GatewayConfig,
  GatewayHooks,
  GatewayProbes,
  GatewayResponse,
  JwtAuthConfig,
  RateLimitResult,
  RateLimitRule,
  RateLimiterOptions,
  RedisLike,
  RequestContext,
  RouteAuth,
  RouteCacheConfig,
  RouteConfig,
  RoutePrefix,
  UpstreamResponseInfo,
  UpstreamTarget,
  UpstreamUrl,
  VerifiedIdentity,
} from './types.js';
import { CIRCUIT_STATES, CACHE_STATUS, DEFAULTS, ERROR_CODES, FAIL_MODES, HEADERS, SECURITY_EVENT_TYPES, STATUS } from './constants.js';
import { ResponseCache } from './cache/ResponseCache.js';
export type { CacheEntry, CacheLookup } from './cache/ResponseCache.js';
export { InMemoryRedis } from './limiter/InMemoryRedis.js';
export { signJwt, verifyJwt } from './auth/jwt.js';
export type { JwtClaims, JwtVerifyOptions } from './auth/jwt.js';
export {
  createIntrospectionProvider,
  createJwksProvider,
  createJwtProvider,
} from './auth/providers.js';
export { route, group, parseRateLimit, parseDurationMs, normalizePrefix } from './routing/dsl.js';
export type {
  CacheInput,
  DurationString,
  RateLimitInput,
  RateLimitString,
  RouteDefinition,
  RouteResult,
  RouteShortcut,
  UpstreamInput,
} from './routing/dsl.js';
export { loadRoutesDir, loadRoutesDirSync } from './routing/RouteLoader.js';
export { signGatewayRequest, verifyGatewaySignature, resolveSigningConfig } from './security/UpstreamSigner.js';
export type { SignInput, SignResult, VerifyOptions } from './security/UpstreamSigner.js';
export { ApiKeyGuard, hashApiKey } from './security/ApiKeyGuard.js';
export type { ApiKeyAuthResult } from './security/ApiKeyGuard.js';
export { BruteForceGuard } from './security/BruteForceGuard.js';
export {
  allowedOriginValue,
  assertNoMetadataUpstreams,
  assertValidCors,
  buildCorsHeaders,
  contentTypeAllowed,
  isMetadataUpstream,
  isOriginAllowed,
  isPathTraversal,
  isPreflight,
  sanitizeHeaderValue,
} from './security/PerimeterGuard.js';
export { startGateway } from './easy.js';
export type { QuickGatewayOptions, SimpleRateLimit, SimpleRoute, SimpleRouteMap, SimpleUpstream } from './easy.js';

/** Identity helper — validates route shape at compile time. */
export function defineRoute<TReq extends IncomingMessage = IncomingMessage>(
  route: DefineRouteOptions<TReq>,
): RouteConfig<TReq> {
  return route as RouteConfig<TReq>;
}

/** Identity helper — validates gateway config at compile time. */
export function defineGatewayConfig<TReq extends IncomingMessage = IncomingMessage>(
  config: GatewayConfig<TReq>,
): GatewayConfig<TReq> {
  return config;
}

/** Branded-type constructors for literal-safe route/URL values. */
export const asRoutePrefix = (prefix: `/${string}`): RoutePrefix =>
  prefix as RoutePrefix;
export const asUpstreamUrl = (
  url: `http://${string}` | `https://${string}`,
): UpstreamUrl => url as UpstreamUrl;

export {
  createGateway,
  CircuitBreaker,
  RedisRateLimiter,
  LocalFallback,
  Router,
  ProxyHandler,
  extractApiKeyOrIp,
  extractClientIp,
  createCompositeExtractor,
  resolveExtractor,
  getHeaderString,
  sendJson,
  sendGatewayResponse,
  defaultErrorBody,
  CIRCUIT_STATES,
  CACHE_STATUS,
  DEFAULTS,
  ERROR_CODES,
  FAIL_MODES,
  HEADERS,
  SECURITY_EVENT_TYPES,
  STATUS,
};

export type {
  ApiKeyGuardConfig,
  ApiKeyProvider,
  ApiKeyRecord,
  AuthConfig,
  AuthOutcome,
  AuthProvider,
  Brand,
  IntrospectionProviderOptions,
  JwksProviderOptions,
  BruteForceConfig,
  CircuitBreakerLike,
  CorsConfig,
  GatewayPlugin,
  GatewayStore,
  PluginContext,
  PolicyDecision,
  SecurityAuditEvent,
  SecurityEventType,
  SecurityHeadersConfig,
  UpstreamSigningConfig,
  CircuitBreakerOptions,
  CircuitState,
  ClientKeyExtractor,
  DefineRouteOptions,
  ErrorCode,
  FailMode,
  Gateway,
  GatewayConfig,
  GatewayHooks,
  GatewayProbes,
  GatewayResponse,
  JwtAuthConfig,
  ShutdownOptions,
  RateLimitResult,
  RateLimitRule,
  RateLimiterOptions,
  RedisLike,
  RequestContext,
  RouteAuth,
  RouteCacheConfig,
  RouteConfig,
  RoutePrefix,
  UpstreamResponseInfo,
  UpstreamTarget,
  UpstreamUrl,
  VerifiedIdentity,
};
