import { proxy } from '../_proxy.js';

// /opensky/*  ->  https://opensky-network.org/api/*
export async function onRequest({ request, params }) {
  const { search } = new URL(request.url);
  const path = Array.isArray(params.path) ? params.path.join('/') : params.path ?? '';
  return proxy(request, `https://opensky-network.org/api/${path}${search}`);
}
