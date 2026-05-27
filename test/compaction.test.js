import { expect, test } from 'vitest'
import { estimateTokens, shouldCompact } from '../src/agent/compaction.js'

test('estimateTokens heuristic', () => {
  const messages = [
    { role: 'user', content: 'Hello there' },
    { role: 'assistant', content: 'Hi, how can I help you today?' }
  ]
  const tokens = estimateTokens(messages)
  expect(tokens).toBeGreaterThan(0)
  // 'Hello there' + long assistant -> chars ~ 40 -> tokens ~ 10
  expect(tokens).toBeLessThan(100)
})

test('shouldCompact false when under threshold', () => {
  const messages = [{ role: 'user', content: 'short message' }]
  const config = { maxTokenEstimate: 1000, keepRecentMessages: 5 }
  expect(shouldCompact(messages, config)).toBe(false)
})

test('shouldCompact true when over threshold', () => {
  const long = 'a'.repeat(5000)
  const messages = [{ role: 'user', content: long }]
  const config = { maxTokenEstimate: 100, keepRecentMessages: 5 }
  expect(shouldCompact(messages, config)).toBe(true)
})
