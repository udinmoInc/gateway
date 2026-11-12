import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    express: 'src/adapters/express.ts',
    fastify: 'src/adapters/fastify.ts',
  },
  format: ['esm', 'cjs'],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  platform: 'node',
  external: ['ioredis', 'express', 'fastify'],
  splitting: false,
});
