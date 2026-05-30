// Round-robin model selector. Picks the next model from a pool in order,
// cycling back to the start. Uses a simple atomic counter — safe for
// single-process Node.js (no shared memory across workers).
//
// Usage:
//   const pick = makeRoundRobin(["gpt-5.5", "claude-opus-4.7"]);
//   pick() // "gpt-5.5"
//   pick() // "claude-opus-4.7"
//   pick() // "gpt-5.5"  (wraps)

export function makeRoundRobin(models: string[]): () => string {
  if (models.length === 0) throw new Error("Round-robin pool must not be empty");
  let idx = 0;
  return () => {
    const model = models[idx % models.length];
    idx = (idx + 1) % models.length;
    return model;
  };
}

// Resolve a model name or pool to a picker function.
// - Single string → always returns that string
// - Array → round-robin
export function resolveModelPicker(modelOrPool: string | string[]): () => string {
  if (Array.isArray(modelOrPool)) {
    return makeRoundRobin(modelOrPool);
  }
  return () => modelOrPool;
}
