#!/usr/bin/env node
/**
 * udinmo-gateway â€” zero-code CLI for @udinmoinc/gateway.
 *
 *   udinmo-gateway start --port 8080 --target http://localhost:3000 [--limit 60/sec]
 *   udinmo-gateway init
 *   udinmo-gateway doctor --config ./gateway.config.mjs
 */
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGateway } from './core/GatewayEngine.js';
import { parseRateLimit } from './routing/dsl.js';
import type { RateLimitString } from './routing/dsl.js';
import { normalizeRoutes } from './routing/normalize.js';
import { assertNoMetadataUpstreams } from './security/PerimeterGuard.js';
import type { RouteConfig, RoutesInput, UpstreamUrl } from './types.js';

const USAGE = `udinmo-gateway â€” zero-code gateway CLI

Commands:
  start --port <port> --target <upstreamUrl> [--limit <rate>]
      Launch a live gateway immediately (no config file).
      --limit accepts '60/sec' | '120/min' | '1000/hour'.
  init
      Write a commented gateway.config.mjs starter to the cwd.
  doctor --config <path>
      Validate route configs, check SSRF safety, ping upstreams.
`;

const CONFIG_TEMPLATE = `// udinmo-gateway configuration
// Docs: https://github.com/udinmoInc/gateway
import { createGateway, route, group, asProtection } from '@udinmoinc/gateway';

export const routes = [
  // Public API â€” 120 requests/minute per client IP, 30s response cache.
  route('/api/*', 'http://localhost:3000', {
    rateLimit: '120/min',
    cache: '30s',
  }),

  // Admin API â€” guarded by your own EdgeGuard/provider.
  // group('/admin', { guards: [asProtection(yourAuthProvider)] }, [
  //   route('/users', 'http://localhost:4001'),
  // ]),
];

export async function main() {
  const gateway = createGateway({
    routes,
    // stripHeaders: ['x-internal-debug'],
    // cors: { origins: ['https://app.example.com'] },
    // metricsPath: '/gateway/metrics',
    // upstreamSigning: { secret: process.env.GW_SIGNING_SECRET },
  });

  const port = Number(process.env.PORT ?? 8080);
  await gateway.listen(port);
  console.log(\`[gateway] listening on :\${port}\`);

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void gateway.shutdown().then(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error('[gateway] fatal:', err);
  process.exit(1);
});
`;

export interface ParsedArgs {
  values: Record<string, string | boolean | (string | boolean)[] | undefined>;
  positionals: string[];
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const spec =
    command === 'start'
      ? {
          options: {
            port: { type: 'string' as const },
            target: { type: 'string' as const },
            limit: { type: 'string' as const },
            host: { type: 'string' as const },
          },
        }
      : command === 'doctor'
        ? {
            options: {
              config: { type: 'string' as const },
            },
          }
        : { options: {} };
  const { values, positionals } = parseArgs({
    args: rest,
    options: spec.options,
    allowPositionals: true,
    strict: true,
  });
  return { values, positionals };
}

function str(values: ParsedArgs['values'], key: string): string | undefined {
  const v = values[key];
  return typeof v === 'string' ? v : undefined;
}

export async function cmdStart(values: ParsedArgs['values']): Promise<void> {
  const portRaw = str(values, 'port');
  const target = str(values, 'target');
  if (!portRaw || !target) {
    console.error('start requires --port <port> and --target <upstreamUrl>');
    process.exitCode = 1;
    return;
  }
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[gateway] invalid --port "${portRaw}"`);
    process.exitCode = 1;
    return;
  }
  if (!/^https?:\/\/\S+$/.test(target)) {
    console.error(`[gateway] invalid --target "${target}" â€” must be http(s):// URL`);
    process.exitCode = 1;
    return;
  }

  const limitRaw = str(values, 'limit');
  const rateLimit =
    limitRaw !== undefined ? parseRateLimit(limitRaw as RateLimitString) : undefined;
  const host = str(values, 'host') ?? '0.0.0.0';

  const gateway = createGateway({
    target,
    ...(rateLimit !== undefined ? { rateLimit } : {}),
  });
  await gateway.listen(port, host);
  console.log(`[gateway] listening on http://${host}:${port} â†’ ${target}`);
  if (rateLimit) {
    console.log(`[gateway] rate limit: ${rateLimit.capacity} burst, ${rateLimit.refillPerSecond}/s refill`);
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void gateway.shutdown().then(() => process.exit(0));
    });
  }
}

export async function cmdInit(dir: string = process.cwd()): Promise<void> {
  const target = resolve(dir, 'gateway.config.mjs');
  await writeFile(target, CONFIG_TEMPLATE, 'utf8');
  console.log(`[gateway] wrote ${target}`);
  console.log('[gateway] run it with: node gateway.config.mjs');
}

interface DoctorConfig {
  routes?: readonly RouteConfig[];
}

export async function cmdDoctor(configPath: string | undefined): Promise<void> {
  if (!configPath) {
    console.error('doctor requires --config <path>');
    process.exitCode = 1;
    return;
  }
  const abs = resolve(process.cwd(), configPath);
  let mod: { routes?: unknown; default?: { routes?: unknown } };
  try {
    mod = (await import(pathToFileURL(abs).href)) as typeof mod;
  } catch (err) {
    console.error(`[gateway] cannot load ${abs}: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }
  // Accept every ergonomic shape (shorthands, route() defs, object maps)
  // and normalize to strict RouteConfig before validating.
  let routes: readonly RouteConfig[];
  try {
    const rawRoutes = (mod.routes ?? mod.default?.routes) as
      | RoutesInput
      | undefined;
    const normalized = normalizeRoutes(rawRoutes);
    if (normalized === undefined || normalized.length === 0) {
      throw new Error('empty');
    }
    routes = normalized;
  } catch {
    console.error('[gateway] config must export a non-empty `routes` array or map');
    process.exitCode = 1;
    return;
  }

  let failures = 0;
  const upstreams = new Set<string>();
  for (const [i, route] of routes.entries()) {
    const label = `route[${i}] prefix=${String(route?.prefix)}`;
    if (typeof route?.prefix !== 'string' || !route.prefix.startsWith('/')) {
      console.error(`  FAIL ${label}: prefix must start with '/'`);
      failures += 1;
      continue;
    }
    const ups = route.upstreams;
    if (!Array.isArray(ups) || ups.length === 0) {
      console.error(`  FAIL ${label}: at least one upstream required`);
      failures += 1;
      continue;
    }
    for (const u of ups) {
      if (typeof u?.url !== 'string' || !/^https?:\/\/\S+$/.test(u.url)) {
        console.error(`  FAIL ${label}: invalid upstream "${String(u?.url)}"`);
        failures += 1;
        continue;
      }
      upstreams.add(u.url);
      try {
        new URL(u.url);
      } catch {
        console.error(`  FAIL ${label}: unparseable upstream "${u.url}"`);
        failures += 1;
      }
    }
    console.log(`  ok   ${label} â†’ ${ups.map((u) => u.url).join(', ')}`);
  }

  // SSRF / metadata-upstream check across all routes.
  try {
    assertNoMetadataUpstreams(
      routes.flatMap((r) => (r.upstreams ?? []).map((u) => u.url)),
      false,
    );
    console.log('  ok   SSRF metadata-upstream check passed');
  } catch (err) {
    console.error(`  FAIL SSRF check: ${err instanceof Error ? err.message : err}`);
    failures += 1;
  }

  // Ping each unique upstream (HEAD, 2s timeout).
  for (const url of upstreams) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(2_000),
      });
      console.log(`  ok   upstream ${url} â†’ HTTP ${res.status} (${Date.now() - t0}ms)`);
      await res.arrayBuffer().catch(() => undefined);
    } catch (err) {
      console.error(`  FAIL upstream ${url} unreachable: ${err instanceof Error ? err.message : err}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`[gateway] doctor found ${failures} problem(s)`);
    process.exitCode = 1;
  } else {
    console.log('[gateway] doctor: all checks passed');
  }
}

export async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }
  const { values } = parseCliArgs([command, ...rest]);
  switch (command) {
    case 'start':
      await cmdStart(values);
      return;
    case 'init':
      await cmdInit();
      return;
    case 'doctor':
      await cmdDoctor(str(values, 'config'));
      return;
    default:
      console.error(`[gateway] unknown command "${command}"\n`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

// Only auto-run when executed directly (node dist/cli.mjs / bin), not on import.
const invokedAs = process.argv[1];
const isMain =
  invokedAs !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedAs)).href;
if (isMain) {
  main().catch((err) => {
    console.error('[gateway] fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
