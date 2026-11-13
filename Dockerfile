# Multi-stage build for @udinmoinc/gateway — zero runtime dependencies,
# so the final image is just Node + the bundled dist/ output.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json LICENSE README.md ./
COPY --from=build /app/dist ./dist
# Optional: mount a gateway.config.mjs or pass CLI flags.
#   docker run -p 8080:8080 -v $PWD/gateway.config.mjs:/app/gateway.config.mjs \
#     udinmo/gateway start --port 8080 --target http://upstream:4000
EXPOSE 8080
ENTRYPOINT ["node", "dist/cli.mjs"]
CMD ["start", "--port", "8080", "--target", "http://localhost:4000"]
