import { proxy } from '../_proxy.js';

// /opensky-auth/*  ->  https://auth.opensky-network.org/*  (OAuth token endpoint)
export async function onRequest({ request, params }) {
  const { search } = new URL(request.url);
  const path = Array.isArray(params.path) ? params.path.join('/') : params.path ?? '';
  return proxy(request, `https://auth.opensky-network.org/${path}${search}`);
}
