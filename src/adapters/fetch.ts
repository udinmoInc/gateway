import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Gateway } from '../core/GatewayEngine.js';
import type { GatewayConfig, RouteConfig } from '../types.js';
import { createAdapterGateway } from './adapterCore.js';
import type { AdapterGatewayConfig } from './adapterCore.js';

export type FetchGatewayOptions = AdapterGatewayConfig;

/**
 * Minimal IncomingMessage backed by a Readable — carries method, url,
 * headers and an optional buffered body into the gateway pipeline.
 */
function requestToIncoming(req: Request): IncomingMessage {
  const url = new URL(req.url);
  const msg = new Readable({
    read() {
      /* body pushed eagerly below */
    },
  }) as unknown as IncomingMessage;
  msg.method = req.method;
  msg.url = `${url.pathname}${url.search}`;
  msg.headers = Object.fromEntries(req.headers.entries());
  msg.httpVersion = '1.1';
  msg.httpVersionMajor = 1;
  msg.httpVersionMinor = 1;
  msg.aborted = false;
  msg.complete = true;
  msg.socket = {
    remoteAddress: '127.0.0.1',
    destroyed: false,
  } as unknown as IncomingMessage['socket'];
  return msg;
}

interface CapturedResponse {
  statusCode: number;
  headers: Map<string, string>;
  chunks: Buffer[];
  ended: Promise<void>;
}

/**
 * Minimal ServerResponse backed by a Writable — captures status, headers
 * and body so the pipeline can be driven without a real socket.
 */
class FetchResponseSink extends Writable {
  statusCode = 200;
  readonly headers = new Map<string, string>();
  private headWritten = false;
  private readonly chunks: Buffer[] = [];
  private resolveEnded!: () => void;
  readonly ended: Promise<void>;

  constructor() {
    super();
    this.ended = new Promise<void>((r) => {
      this.resolveEnded = r;
    });
    this.on('finish', () => this.resolveEnded());
    this.on('close', () => this.resolveEnded());
  }

  get headersSent(): boolean {
    return this.headWritten;
  }

  setHeader(name: string, value: string | number | readonly string[]): void {
    const v = Array.isArray(value) ? value.join(', ') : String(value);
    this.headers.set(name.toLowerCase(), v);
  }

  writeHead(
    statusCode: number,
    headers?: Record<string, string | string[] | undefined>,
  ): this {
    this.statusCode = statusCode;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (v === undefined) continue;
        this.setHeader(k, Array.isArray(v) ? v.join(', ') : v);
      }
    }
    this.headWritten = true;
    return this;
  }

  override _write(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    cb();
  }

  body(): Buffer {
    return Buffer.concat(this.chunks);
  }

  toResponse(): Response {
    const headers = new Headers();
    for (const [k, v] of this.headers) headers.set(k, v);
    return new Response(this.body(), {
      status: this.statusCode,
      headers,
    });
  }
}

/**
 * Web-standard fetch adapter — runs the full gateway pipeline in-process
 * for Request → Response handlers (Next.js route.ts, Hono, Bun, Node 20+).
 *
 * Usage:
 *   const gw = createFetchGateway({ routes: [...] });
 *   export async function GET(req: Request) { return gw(req); }
 */
export function createFetchGateway(
  config: FetchGatewayOptions,
): (request: Request) => Promise<Response> {
  const gateway: Gateway<IncomingMessage> =
    createAdapterGateway<IncomingMessage>(config);

  return async (request: Request): Promise<Response> => {
    const incoming = requestToIncoming(request);
    const sink = new FetchResponseSink();

    // Buffer the (usually small) fetch body, then feed the stream.
    if (request.body !== null) {
      const buf = Buffer.from(await request.arrayBuffer());
      if (buf.length > 0) {
        incoming.push(buf);
      }
    }
    incoming.push(null);

    const res = sink as unknown as ServerResponse;
    await gateway.handleRequest(incoming, res);
    await sink.ended;
    return sink.toResponse();
  };
}

export { createGateway } from '../core/GatewayEngine.js';
export type { Gateway, GatewayConfig, RouteConfig };
