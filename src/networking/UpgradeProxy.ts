import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import type { IncomingMessage } from 'node:http';
import { HEADERS, DEFAULTS } from '../constants.js';
import { sanitizeHeaderValue, hopByHopSet } from '../shared/httpUtils.js';
import { deadlineTimer, destroySafely } from '../shared/timers.js';
import type { UpstreamTarget } from '../types.js';

const HOP_FOR_UPGRADE = hopByHopSet(['host']);

export interface UpgradeTunnelOptions {
  /** Path (with query) to request upstream — same as HTTP proxying. */
  path: string;
  /** Trusted headers emitted by edge guards, injected on the handshake. */
  guardHeaders?: Record<string, string> | undefined;
  /** Pre-normalized lowercase header names to strip (boot-time Set). */
  stripHeaders?: ReadonlySet<string> | undefined;
  /** Handshake deadline (ms); cleared once the tunnel is established. */
  handshakeTimeoutMs?: number | undefined;
}

function buildHandshake(
  req: IncomingMessage,
  target: UpgradeTunnelOptions,
  upstream: URL,
): string {
  const lines: string[] = [
    `${req.method ?? 'GET'} ${target.path} HTTP/1.1`,
  ];
  const strip = target.stripHeaders;
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_FOR_UPGRADE.has(name)) continue;
    if (strip !== undefined && strip.has(name)) continue;
    const v = Array.isArray(value)
      ? value.map(sanitizeHeaderValue).join(', ')
      : sanitizeHeaderValue(value);
    lines.push(`${name}: ${v}`);
  }
  // Upstream host header must reflect the target.
  lines.push(`host: ${upstream.host}`);
  // Inject guard-emitted trusted headers on the handshake.
  if (target.guardHeaders) {
    for (const [name, value] of Object.entries(target.guardHeaders)) {
      lines.push(`${name}: ${value}`);
    }
  }
  const fwd = req.socket.remoteAddress;
  if (fwd) lines.push(`${HEADERS.forwardedFor}: ${fwd}`);
  lines.push('', '');
  return lines.join('\r\n');
}

/**
 * Zero-copy WebSocket/SSE upgrade tunnel: forwards the raw HTTP
 * handshake to the upstream over TCP/TLS, then pipes bytes both ways.
 * Sockets are noDelay'd and torn down symmetrically on error/close so
 * half-closed connections never leak.
 */
export function proxyUpgrade(
  req: IncomingMessage,
  clientSocket: net.Socket,
  head: Buffer,
  upstream: UpstreamTarget,
  options: UpgradeTunnelOptions,
): void {
  const url = new URL(upstream.url);
  const isHttps = url.protocol === 'https:';
  const port = Number(url.port) || (isHttps ? 443 : 80);

  const handshake = buildHandshake(req, options, url);
  const timeoutMs =
    options.handshakeTimeoutMs ?? DEFAULTS.networking.upgradeHandshakeTimeoutMs;

  const upstreamSocket: net.Socket = isHttps
    ? tls.connect({ host: url.hostname, port, servername: url.hostname })
    : net.connect({ host: url.hostname, port });

  upstreamSocket.setNoDelay(true);
  clientSocket.setNoDelay(true);

  let settled = false;
  const timer = deadlineTimer(timeoutMs, teardown);

  function teardown(): void {
    if (settled) return;
    settled = true;
    timer.clear();
    destroySafely(upstreamSocket, clientSocket);
  }

  upstreamSocket.on('error', teardown);
  clientSocket.on('error', teardown);
  upstreamSocket.on('close', () => destroySafely(clientSocket));
  clientSocket.on('close', () => destroySafely(upstreamSocket));

  upstreamSocket.once(isHttps ? 'secureConnect' : 'connect', () => {
    // Handshake deadline only applies until the tunnel is established —
    // clear it so long-lived WebSocket/SSE connections are never killed.
    timer.clear();
    upstreamSocket.write(handshake);
    if (head.length > 0) upstreamSocket.write(head);
    // Bi-directional zero-copy pipe after handshake.
    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);
  });
}

