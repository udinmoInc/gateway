import type { IncomingMessage } from 'node:http';
import { HEADERS } from '../constants.js';
import type { CorsConfig, UpstreamUrl } from '../types.js';
import { getHeaderString } from '../utils/extractors.js';

/** Path-traversal / injection patterns blocked at the edge. */
const TRAVERSAL_RE = /(?:^|\/)\.\.(?:\/|$)|%2e%2e|%2e\.|\.%2e|\0|%00/i;

/** Link-local / cloud-metadata targets blocked by the SSRF guard. */
const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

function isLinkLocalIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  return octets[0] === 169 && octets[1] === 254;
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  return h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd00:ec2');
}

/** True when the URL targets link-local/metadata infrastructure (SSRF). */
export function isMetadataUpstream(url: UpstreamUrl | string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return true; // unparseable → treat as unsafe
  }
  if (METADATA_HOSTNAMES.has(hostname)) return true;
  if (isLinkLocalIpv4(hostname)) return true;
  if (hostname.includes(':') && isBlockedIpv6(hostname)) return true;
  return false;
}

/** Validate all configured upstreams at boot; throws on metadata targets. */
export function assertNoMetadataUpstreams(
  urls: readonly (UpstreamUrl | string)[],
  allowMetadata: boolean,
): void {
  if (allowMetadata) return;
  for (const url of urls) {
    if (isMetadataUpstream(url)) {
      throw new Error(
        `[gateway] Upstream "${url}" targets a link-local/metadata address. ` +
          'Set allowMetadataUpstreams: true to override the SSRF guard.',
      );
    }
  }
}

/** Max percent-decode passes applied when checking for traversal. */
const MAX_DECODE_PASSES = 3;

/**
 * True when the request path contains traversal/injection segments.
 * Applies up to MAX_DECODE_PASSES bounded decode passes so multi-encoded
 * payloads (e.g. %252e%252e) cannot bypass the check, and malformed
 * percent sequences are treated as hostile (→ 400) rather than throwing.
 */
export function isPathTraversal(pathname: string): boolean {
  if (TRAVERSAL_RE.test(pathname)) return true;
  let current = pathname;
  for (let i = 0; i < MAX_DECODE_PASSES; i += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return true; // malformed percent-encoding → reject as traversal
    }
    if (decoded === current) return false;
    if (TRAVERSAL_RE.test(decoded)) return true;
    current = decoded;
  }
  return TRAVERSAL_RE.test(current);
}

// sanitizeHeaderValue lives in shared/httpUtils (single source); re-exported
// here for backwards compatibility.
export { sanitizeHeaderValue } from '../shared/httpUtils.js';

/** Content-Type enforcement for routes with allowedContentTypes (pre-normalized lowercase Set). */
export function contentTypeAllowed(
  req: IncomingMessage,
  allowed: ReadonlySet<string>,
): boolean {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const contentType = getHeaderString(req, 'content-type');
  if (!contentType) return false;
  const mime = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return allowed.has(mime);
}

// ---------- CORS ----------

export function isOriginAllowed(
  cors: CorsConfig,
  origin: string | undefined,
): boolean {
  if (cors.origins === '*') return true;
  if (!origin) return false;
  return cors.origins.includes(origin);
}

export function allowedOriginValue(cors: CorsConfig, origin: string | undefined): string | undefined {
  if (cors.origins === '*') return cors.credentials ? origin : '*';
  if (origin && cors.origins.includes(origin)) return origin;
  return undefined;
}

export function buildCorsHeaders(
  cors: CorsConfig,
  origin: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const allowOrigin = allowedOriginValue(cors, origin);
  if (allowOrigin === undefined) return headers;
  headers[HEADERS.accessControlAllowOrigin] = allowOrigin;
  if (cors.credentials) headers[HEADERS.accessControlAllowCredentials] = 'true';
  if (cors.methods && cors.methods.length > 0) {
    headers[HEADERS.accessControlAllowMethods] = cors.methods.join(', ');
  }
  if (cors.headers && cors.headers.length > 0) {
    headers[HEADERS.accessControlAllowHeaders] = cors.headers.join(', ');
  }
  if (cors.maxAgeSec !== undefined) {
    headers[HEADERS.accessControlMaxAge] = String(cors.maxAgeSec);
  }
  return headers;
}

export function isPreflight(req: IncomingMessage): boolean {
  return (
    (req.method ?? '') === 'OPTIONS' &&
    getHeaderString(req, HEADERS.origin) !== undefined &&
    getHeaderString(req, HEADERS.accessControlRequestMethod) !== undefined
  );
}

/** Validate CORS config at boot (wildcard + credentials is invalid). */
export function assertValidCors(cors: CorsConfig): void {
  if (cors.origins === '*' && cors.credentials === true) {
    throw new Error(
      '[gateway] CORS misconfiguration: origins: "*" cannot be combined with credentials: true.',
    );
  }
}
