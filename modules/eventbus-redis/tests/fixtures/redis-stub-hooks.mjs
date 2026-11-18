// Module resolve hook: send the bare specifier `redis` to the in-process stub.
const STUB = new URL('./redis-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'redis') return {url: STUB, shortCircuit: true};
  return next(specifier, context);
}
