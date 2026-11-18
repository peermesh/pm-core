// Only Traefik may reach this service: deploy it on the dedicated edge-control
// network, never on a module network. Forwarded fields alone prove no caller.
export function createGateway({ modules, operatorOrigin }, { authorize, fetcher = fetch }) {
  const reject = () => { throw Object.assign(new Error('unauthorized'), { status: 401 }); };
  // Each module has its own host and its own hop secret; no two may share either.
  const names = ['publisher', 'media', 'podcast'];
  if (typeof authorize !== 'function' || !modules ||
      // typeof: RegExp#test(undefined) tests the string "undefined" and passes.
      !names.every(name => typeof modules[name]?.host === 'string' && /^[a-z0-9.-]+$/.test(modules[name].host) &&
        /^[\x21-\x7e]{32,1024}$/.test(modules[name]?.secret)) ||
      new Set(names.map(name => modules[name].host)).size !== names.length ||
      new Set(names.map(name => modules[name].secret)).size !== names.length ||
      Object.values(modules).some(m => m.host === 'peers.social')) throw Error('invalid gateway configuration');
  // A fixed private outpost, never an origin or endpoint supplied by a caller.
  if (operatorOrigin !== 'http://authentik-server:9000') throw Error('invalid operator origin');
  return async (path, headers) => {
    const route = /^\/verify\/(publisher|media|podcast)(\/operator)?$/.exec(path);
    if (!route) reject();
    const module = modules[route[1]];
    if (headers['x-forwarded-proto'] !== 'https' || headers['x-forwarded-host'] !== module.host ||
        typeof headers['x-forwarded-method'] !== 'string' || !/^[A-Z]{3,12}$/.test(headers['x-forwarded-method'])) reject();
    // The internal stream contract uses MEDIA_MODULE_SECRET and attachment
    // consent. It must never receive the user gateway credential.
    const uri = headers['x-forwarded-uri'];
    if (typeof uri !== 'string' || !uri.startsWith('/') || uri.startsWith('//') || /[\\\x00-\x20]/.test(uri)) reject();
    let pathname;
    try { pathname = decodeURIComponent(new URL(uri, 'https://' + module.host).pathname); } catch { reject(); }
    if (route[1] === 'media' && /^\/api\/media\/(?:[^/]+\/)?stream(?:\/|$)/.test(pathname)) reject();
    // Podcast's service-only routes authenticate MODULE_SECRET in the same
    // X-Module-Secret header. They must never receive the user hop credential.
    if (route[1] === 'podcast' &&
        /^\/api\/(?:podcast\/cron|webhooks\/events|maintenance\/cleanup)(?:\/|$)/.test(pathname)) reject();
    if (!route[2]) return { ...await authorize(headers), 'X-Module-Secret': module.secret };

    // Existing operator policy remains Authentik's. Revalidate there rather
    // than trusting caller F2 headers or treating Social roles as operators.
    const forwarded = {};
    for (const key of ['authorization', 'cookie', 'x-forwarded-proto', 'x-forwarded-host',
      'x-forwarded-method', 'x-forwarded-uri', 'x-forwarded-for']) {
      if (typeof headers[key] === 'string') forwarded[key] = headers[key];
    }
    const result = await fetcher(operatorOrigin + '/outpost.goauthentik.io/auth/traefik', {
      headers: forwarded, redirect: 'manual', signal: AbortSignal.timeout(3000),
    });
    await result.body?.cancel();
    if (!result.ok) reject();
    // The existing admin middleware owns the five identity headers. This
    // second check emits only the selected hop credential after success.
    return { 'X-Module-Secret': module.secret };
  };
}
