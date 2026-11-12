// Pages hosts the UI; only read requests reach the desktop's view-only gateway.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) {
      return Response.json({ detail: 'Public dashboard is view-only' }, {
        status: 405, headers: { Allow: 'GET, HEAD' },
      });
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    let origin;
    try {
      origin = new URL(env.PUBLIC_API_ORIGIN);
      if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.trycloudflare.com') ||
          origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.port) {
        throw new Error('Invalid origin');
      }
    } catch {
      return Response.json({ detail: 'Desktop connection is not configured' }, { status: 503 });
    }
    // Keep the configured hostname; never interpret the visitor path as a URL.
    origin.pathname = url.pathname;
    origin.search = url.search;
    try {
      const response = await fetch(origin, {
        method: request.method,
        redirect: 'manual',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(60000),
      });
      if (!response.headers.get('content-type')?.includes('application/json')) {
        return Response.json({ detail: 'Desktop connection is offline' }, { status: 503 });
      }
      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return Response.json({ detail: 'Desktop connection is offline' }, { status: 503 });
    }
  },
};
