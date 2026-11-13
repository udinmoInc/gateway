import type { IncomingMessage } from 'node:http';
import { createGateway } from './core/GatewayEngine.js';
import type { Gateway, ShutdownOptions } from './core/GatewayEngine.js';
import { CircuitBreaker } from './core/CircuitBreaker.js';
import type { CircuitBreakerLike } from './core/CircuitBreaker.js';
import { MetricsCollector } from './core/MetricsCollector.js';
import type { MetricOutcome } from './core/MetricsCollector.js';
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
import { normalizeRoute } from './routing/normalize.js';
import type {
  Brand,
  BruteForceConfig,
  CircuitBreakerInput,
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
  EdgeGuard,
  EdgeGuardDecision,
  EdgeRequestContext,
  ErrorCode,
  ProtectionProvider,
  FailMode,
  GatewayConfig,
  GatewayHooks,
  GatewayProbes,
  GatewayResponse,
  HedgingConfig,
  IdempotencyConfig,
  LoadSheddingConfig,
  MappedRouteConfig,
  PathRouteConfig,
  RateLimitResult,
  RateLimitRule,
  RateLimitSource,
  RateLimiterOptions,
  RedisLike,
  RequestContext,
  RouteCacheConfig,
  RouteConfig,
  RouteInput,
  RouteMapInput,
  RoutePrefix,
  RouteReloadConfig,
  RoutesInput,
  UpstreamPoolMetrics,
  UpstreamResponseInfo,
  UpstreamTarget,
  UpstreamTargetInput,
  UpstreamUrl,
} from './types.js';
import { CIRCUIT_STATES, CACHE_STATUS, DEFAULTS, ERROR_CODES, FAIL_MODES, HEADERS, SECURITY_EVENT_TYPES, STATUS } from './constants.js';
export { ResponseCache } from './cache/ResponseCache.js';
export type { CacheEntry, CacheLookup } from './cache/ResponseCache.js';
export { RequestCoalescer } from './cache/RequestCoalescer.js';
export { IdempotencyManager } from './resilience/IdempotencyManager.js';
export type { IdempotencyBegin, IdempotentResult } from './resilience/IdempotencyManager.js';
export { LoadShedder } from './networking/LoadShedder.js';
export { LoadBalancer } from './routing/LoadBalancer.js';
export { listenCluster } from './networking/ClusterSupervisor.js';
export type { ClusterGateway, ClusterOptions } from './networking/ClusterSupervisor.js';
export { proxyUpgrade } from './networking/UpgradeProxy.js';
export { InMemoryRedis } from './limiter/InMemoryRedis.js';
export { allOf, anyOf, composeGuards, requireHeader, requireTag } from './core/guards.js';
export { asProtection, providerToGuard } from './routing.js';
export type { ProtectionApplier, ProtectionSource } from './routing.js';
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

/**
 * Route builder — accepts every shorthand shape (plain-string prefix,
 * `to` alias, '600/min' rate limits, weighted upstream objects) and
 * returns a normalized RouteConfig. No brand casts needed.
 */
export function defineRoute<TReq extends IncomingMessage = IncomingMessage>(
  route: RouteInput<TReq>,
): RouteConfig<TReq> {
  return normalizeRoute<TReq>(route);
}

/** Identity helper — validates gateway config at compile time. */
export function defineGatewayConfig<TReq extends IncomingMessage = IncomingMessage>(
  config: GatewayConfig<TReq>,
): GatewayConfig<TReq> {
  return config;
}

/** Branded-type constructors — runtime-validated (shared single source). */
export { asRoutePrefix, asUpstreamUrl } from './shared/httpUtils.js';

export {
  createGateway,
  CircuitBreaker,
  MetricsCollector,
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
  Brand,
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
  CircuitBreakerInput,
  CircuitBreakerOptions,
  CircuitState,
  ClientKeyExtractor,
  DefineRouteOptions,
  EdgeGuard,
  EdgeGuardDecision,
  EdgeRequestContext,
  ErrorCode,
  ProtectionProvider,
  FailMode,
  Gateway,
  GatewayConfig,
  GatewayHooks,
  GatewayProbes,
  GatewayResponse,
  HedgingConfig,
  IdempotencyConfig,
  LoadSheddingConfig,
  MappedRouteConfig,
  MetricOutcome,
  PathRouteConfig,
  ShutdownOptions,
  RateLimitResult,
  RateLimitRule,
  RateLimitSource,
  RateLimiterOptions,
  RedisLike,
  RequestContext,
  RouteCacheConfig,
  RouteConfig,
  RouteInput,
  RouteMapInput,
  RoutePrefix,
  RouteReloadConfig,
  RoutesInput,
  UpstreamPoolMetrics,
  UpstreamResponseInfo,
  UpstreamTarget,
  UpstreamTargetInput,
  UpstreamUrl,
};
