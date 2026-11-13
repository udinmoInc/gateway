import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HOP_BY_HOP_HEADERS, HEADERS, STATUS, DEFAULTS } from '../constants.js';
import type { UpstreamPoolMetrics } from '../types.js';
import { sanitizeHeaderValue, HOP_BY_HOP_SET } from '../shared/httpUtils.js';
import { deadlineTimer } from '../shared/timers.js';
import { signGatewayRequest } from '../security/UpstreamSigner.js';
import type { UpstreamResponseInfo, UpstreamTarget } from '../types.js';
import { getHeaderString } from '../utils/extractors.js';

export class UpstreamTimeoutError extends Error {
  constructor(ms: number) {
    super(`upstream timeout after ${ms}ms`);
    this.name = 'UpstreamTimeoutError';
  }
}

export class PayloadTooLargeError extends Error {
  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

export interface ProxyTarget {
  upstream: UpstreamTarget;
  /** Path (with query) to request upstream. */
  path: string;
  /** Extra headers merged into the upstream response. */
  responseHeaders?: Record<string, string> | undefined;
  /**
   * Trusted headers emitted by edge guards, injected onto the
   * upstream request (client-sent copies are overwritten).
   */
  guardHeaders?: Record<string, string> | undefined;
  /** Pre-normalized lowercase header names to strip (boot-time Set). */
  stripHeaders?: ReadonlySet<string> | undefined;
  /** Pre-generated request id (used for signing payload consistency). */
  requestId?: string | undefined;
  /**
   * Fully-buffered request body (e.g. consumed for idempotency
   * fingerprinting). When set, the client stream is not piped.
   */
  bodyOverride?: Buffer | undefined;
  /** Zero-trust upstream HMAC signing parameters. */
  signing?:
    | {
        secret: string;
        /** Generic subject bound into the signature ('' when none). */
        subject: string;
        /** Header carrying the subject upstream. */
        subjectHeader?: string;
        headerName?: string;
        timestampHeader?: string;
      }
    | undefined;
}

const HOP_BY_HOP = HOP_BY_HOP_SET;

/**
 * Zero-copy HTTP/HTTPS forwarder. Streams the client body straight into the
 * upstream request and pipes the upstream response straight back — no
 * buffering of payloads.
 */
export class ProxyHandler {
  private readonly agents = new Map<string, http.Agent | https.Agent>();
  private readonly timeoutMs: number;
  private readonly maxSockets: number;
  private readonly maxFreeSockets: number;
  private readonly keepAliveMsecs: number;

  constructor(options: {
    timeoutMs?: number;
    maxSockets?: number;
    maxFreeSockets?: number;
    keepAliveMsecs?: number;
  } = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxSockets =
      options.maxSockets ?? DEFAULTS.networking.upstreamMaxSockets;
    this.maxFreeSockets =
      options.maxFreeSockets ?? DEFAULTS.networking.upstreamMaxFreeSockets;
    this.keepAliveMsecs =
      options.keepAliveMsecs ?? DEFAULTS.networking.upstreamKeepAliveMsecs;
  }

  /** Live per-upstream-origin connection pool metrics. */
  poolMetrics(): Record<string, Omit<UpstreamPoolMetrics, 'inFlight'>> {
    const out: Record<string, Omit<UpstreamPoolMetrics, 'inFlight'>> = {};
    for (const [origin, agent] of this.agents) {
      let activeSockets = 0;
      let freeSockets = 0;
      for (const list of Object.values(agent.sockets)) {
        if (list) activeSockets += list.length;
      }
      for (const list of Object.values(agent.freeSockets)) {
        if (list) freeSockets += list.length;
      }
      const pending = agent.requests;
      out[origin] = {
        activeSockets,
        freeSockets,
        queuedRequests: Array.isArray(pending) ? pending.length : 0,
      };
    }
    return out;
  }

  /**
   * Forward `req` to the upstream and stream the response into `res`.
   * Resolves with response metadata once upstream headers arrive.
   * Rejects on connect/timeout errors (response may be partially written —
   * callers should treat rejection as fatal for the request).
   */
  forward(
    req: IncomingMessage,
    res: ServerResponse,
    target: ProxyTarget,
    options?: {
      captureBody?: boolean;
      maxBodyBytes?: number;
      maskErrors?: boolean;
      /** AbortSignal — destroys the upstream request when fired (hedging). */
      signal?: AbortSignal;
    },
  ): Promise<UpstreamResponseInfo> {
    return new Promise((resolve, reject) => {
      const maxBodyBytes = options?.maxBodyBytes;
      const contentLength = Number(req.headers['content-length']);
      if (maxBodyBytes !== undefined && Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
        reject(new PayloadTooLargeError(maxBodyBytes));
        return;
      }

      const url = new URL(target.upstream.url);
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const requestId = this.resolveRequestId(req, target);
      const headers = this.buildHeaders(req, url, target, requestId);
      const agent = this.agentFor(url);

      const upstreamReq = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: target.path,
          method: req.method,
          headers,
          agent,
        },
        (upstreamRes) => {
          timer.clear();
          const statusCode = upstreamRes.statusCode ?? STATUS.badGateway;
          if (options?.maskErrors === true && statusCode >= 500) {
            this.maskedResponse(upstreamRes, res, target.responseHeaders, statusCode, resolve);
            return;
          }
          if (options?.captureBody) {
            const chunks: Buffer[] = [];
            upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
            upstreamRes.on('end', () => {
              const body = Buffer.concat(chunks);
              this.writeResponse(upstreamRes, res, target.responseHeaders, body);
              resolve({
                statusCode,
                headers: upstreamRes.headers,
                body,
              });
            });
            upstreamRes.on('error', (err) => {
              res.destroy();
              reject(err);
            });
            return;
          }
          this.pipeResponse(upstreamRes, res, target.responseHeaders);
          resolve({
            statusCode,
            headers: upstreamRes.headers,
          });
        },
      );

      const timer = deadlineTimer(this.timeoutMs, () => {
        upstreamReq.destroy(new UpstreamTimeoutError(this.timeoutMs));
      });
      // 'close' covers destroy()-without-error paths (client abort,
      // hedge abort, payload-too-large) so the timeout never lingers.
      upstreamReq.on('close', () => timer.clear());

      // Client went away — stop work upstream. Note: IncomingMessage 'close'
      // fires on normal request completion too, so we key off the response
      // socket closing prematurely and explicit request aborts instead.
      res.on('close', () => {
        if (!res.writableEnded) upstreamReq.destroy();
      });
      req.on('aborted', () => upstreamReq.destroy());

      upstreamReq.on('error', (err) => {
        timer.clear();
        reject(err instanceof UpstreamTimeoutError ? err : err);
      });

      req.on('error', (err) => {
        timer.clear();
        upstreamReq.destroy();
        reject(err);
      });

      // Hedging support: aborting kills the upstream attempt.
      const onAbort = (): void => {
        timer.clear();
        upstreamReq.destroy(new Error('upstream attempt aborted'));
      };
      if (options?.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
        upstreamReq.on('close', () =>
          options.signal?.removeEventListener('abort', onAbort),
        );
      }

      // Pre-buffered body (idempotency): forward directly, skip piping.
      if (target.bodyOverride !== undefined) {
        upstreamReq.end(target.bodyOverride);
        return;
      }

      // Streamed body-size enforcement for chunked/unknown-length bodies.
      if (maxBodyBytes !== undefined) {
        let received = 0;
        req.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBodyBytes) {
            upstreamReq.destroy(new PayloadTooLargeError(maxBodyBytes));
            req.unpipe(upstreamReq);
          }
        });
      }

      // Zero-copy: stream body through.
      req.pipe(upstreamReq);
    });
  }

  private resolveRequestId(req: IncomingMessage, target: ProxyTarget): string {
    if (target.requestId) return target.requestId;
    const incoming = getHeaderString(req, HEADERS.requestId);
    if (incoming && /^[\w.:-]{1,128}$/.test(incoming)) return incoming;
    return randomUUID();
  }

  private buildHeaders(
    req: IncomingMessage,
    url: URL,
    target: ProxyTarget,
    requestId: string,
  ): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = {};
    const strip = target.stripHeaders;
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || HOP_BY_HOP.has(name)) continue;
      if (strip !== undefined && strip.has(name)) continue;
      headers[name] = Array.isArray(value)
        ? value.map(sanitizeHeaderValue)
        : sanitizeHeaderValue(value);
    }

    headers[HEADERS.requestId] = requestId;

    const clientIp = getHeaderString(req, HEADERS.forwardedFor)
      ? `${getHeaderString(req, HEADERS.forwardedFor)}, ${req.socket.remoteAddress ?? ''}`
      : req.socket.remoteAddress ?? '';
    if (clientIp) headers[HEADERS.forwardedFor] = clientIp;

    const proto = getHeaderString(req, HEADERS.forwardedProto) ?? url.protocol.replace(':', '');
    headers[HEADERS.forwardedProto] = proto;

    // Inject guard-emitted trusted headers (overwrites client copies).
    if (target.guardHeaders) {
      for (const [name, value] of Object.entries(target.guardHeaders)) {
        headers[name.toLowerCase()] = value;
      }
    }

    // Zero-trust upstream HMAC signature.
    if (target.signing) {
      // Forward the subject so downstream verifiers can rebuild the
      // signed payload without out-of-band context.
      if (target.signing.subject !== '' && target.signing.subjectHeader) {
        headers[target.signing.subjectHeader.toLowerCase()] = target.signing.subject;
      }
      const signed = signGatewayRequest({
        secret: target.signing.secret,
        method: req.method ?? 'GET',
        path: target.path,
        subject: target.signing.subject,
        requestId,
        ...(target.signing.headerName !== undefined
          ? { headerName: target.signing.headerName }
          : {}),
        ...(target.signing.timestampHeader !== undefined
          ? { timestampHeader: target.signing.timestampHeader }
          : {}),
      });
      for (const [name, value] of Object.entries(signed.headers)) {
        headers[name] = value;
      }
    }

    return headers;
  }

  private responseHeadersFor(
    upstreamRes: IncomingMessage,
    extraHeaders?: Record<string, string>,
  ): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = {};
    const fingerprint = new Set<string>(DEFAULTS.perimeter.upstreamFingerprintHeaders);
    for (const [name, value] of Object.entries(upstreamRes.headers)) {
      if (value === undefined || HOP_BY_HOP.has(name) || fingerprint.has(name)) continue;
      headers[name] = value;
    }
    if (extraHeaders) {
      for (const [name, value] of Object.entries(extraHeaders)) {
        headers[name.toLowerCase()] = value;
      }
    }
    headers['x-gateway'] = 'udinmoinc';
    return headers;
  }

  private writeResponse(
    upstreamRes: IncomingMessage,
    res: ServerResponse,
    extraHeaders: Record<string, string> | undefined,
    body: Buffer,
  ): void {
    res.writeHead(upstreamRes.statusCode ?? STATUS.badGateway, this.responseHeadersFor(upstreamRes, extraHeaders));
    res.end(body);
  }

  private pipeResponse(
    upstreamRes: IncomingMessage,
    res: ServerResponse,
    extraHeaders?: Record<string, string>,
  ): void {
    res.writeHead(upstreamRes.statusCode ?? STATUS.badGateway, this.responseHeadersFor(upstreamRes, extraHeaders));
    upstreamRes.pipe(res);
    upstreamRes.on('error', () => res.destroy());
  }

  /**
   * maskUpstreamErrors: consume and discard a 5xx upstream body, then
   * answer with a sanitized JSON error so internals never leak.
   */
  private maskedResponse(
    upstreamRes: IncomingMessage,
    res: ServerResponse,
    extraHeaders: Record<string, string> | undefined,
    statusCode: number,
    resolve: (info: UpstreamResponseInfo) => void,
  ): void {
    const chunks: Buffer[] = [];
    upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
    upstreamRes.on('end', () => {
      void chunks; // body intentionally discarded
      const headers = this.responseHeadersFor(upstreamRes, extraHeaders);
      delete headers['content-length'];
      delete headers['content-encoding'];
      headers['content-type'] = 'application/json; charset=utf-8';
      const body = Buffer.from(
        JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: 'upstream error' } }),
      );
      headers['content-length'] = String(body.length);
      res.writeHead(statusCode, headers);
      res.end(body);
      resolve({ statusCode, headers: upstreamRes.headers });
    });
    upstreamRes.on('error', () => {
      res.destroy();
      resolve({ statusCode: STATUS.badGateway, headers: {} });
    });
  }

  /**
   * One keep-alive agent per upstream origin — tuned for high
   * concurrency: LIFO scheduling, no-delay sockets, bounded free pool.
   */
  private agentFor(url: URL): http.Agent | https.Agent {
    const key = url.origin;
    let agent = this.agents.get(key);
    if (!agent) {
      const isHttps = url.protocol === 'https:';
      const opts = {
        keepAlive: true,
        maxSockets: this.maxSockets,
        maxFreeSockets: this.maxFreeSockets,
        keepAliveMsecs: this.keepAliveMsecs,
        scheduling: 'lifo' as const,
        socketNoDelay: true,
      };
      agent = isHttps ? new https.Agent(opts) : new http.Agent(opts);
      this.agents.set(key, agent);
    }
    return agent;
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.agents.values()].map(
        (agent) =>
          new Promise<void>((resolve) => {
            agent.destroy();
            resolve();
          }),
      ),
    );
    this.agents.clear();
  }
}
