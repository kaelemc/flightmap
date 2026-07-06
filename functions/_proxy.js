// Same-origin reverse proxy shared by the /opensky and /opensky-auth Pages
// Functions. OpenSky's API only allows browser CORS from its own origin, so the
// app calls same-origin paths and these forward them server-side — the
// production equivalent of the vite dev/preview proxy in vite.config.ts.
export async function proxy(request, targetUrl) {
  const headers = new Headers();
  for (const name of ['authorization', 'content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const init = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }
  const upstream = await fetch(targetUrl, init);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
