/**
 * Atomic token-bucket consume script.
 *
 * KEYS[1]   bucket key
 * ARGV[1]   capacity (burst size)
 * ARGV[2]   refill rate (tokens per second, float)
 * ARGV[3]   tokens requested (usually 1)
 *
 * Returns { allowed, remainingTokens, capacity, nowSeconds, retryAfterSeconds }
 * Uses Redis TIME so all nodes share one clock — no client-clock skew.
 */
export const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local requested = tonumber(ARGV[3]) or 1

local t = redis.call('TIME')
local now = tonumber(t[1]) + (tonumber(t[2]) / 1000000)

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end

local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + (elapsed * refill))

local allowed = 0
local retryAfter = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
else
  retryAfter = (requested - tokens) / refill
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
local ttlMs = math.ceil(((capacity / refill) * 2) * 1000) + 1000
redis.call('PEXPIRE', key, ttlMs)

return { allowed, tokens, capacity, now, retryAfter }
`;
