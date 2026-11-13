// Private records: deliberately no public list/read endpoint.
const reply = (body, status = 200) => Response.json(body, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
} });
export async function checkIn(request, env) {
  if (request.method !== 'POST') return reply({ detail: 'Method not allowed' }, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return reply({ detail: 'Invalid origin' }, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({ detail: 'Expected JSON' }, 415);
  // Bound streamed bodies too, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return reply({ detail: 'Missing body' }, 400);
  let chunks = [], size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2048) { await reader.cancel(); return reply({ detail: 'Request too large' }, 413); }
    chunks.push(value);
  }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(await new Blob(chunks).arrayBuffer())); }
  catch { return reply({ detail: 'Invalid JSON' }, 400); }
  if (!body || typeof body.name !== 'string' || typeof body.session_id !== 'string' || typeof body.entry_path !== 'string') return reply({ detail: 'Invalid check-in' }, 400);
  const name = body.name.trim().replace(/\s+/g, ' ');
  if (body.anonymous === true || !name || name.length > 80 || /[\x00-\x1f\x7f]/.test(body.name) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.session_id) ||
      !/^\/[a-zA-Z0-9/_-]{0,199}$/.test(body.entry_path)) return reply({ detail: 'Invalid check-in' }, 400);
  if (!env.CHECKINS) return reply({ detail: 'Check-in is temporarily unavailable' }, 503);
  try {
    // SQL bindings prevent injection; duplicate retries do not create extra visits.
    // A global write ceiling bounds storage abuse; this is not DDoS protection.
    const result = await env.CHECKINS.prepare(`INSERT OR IGNORE INTO visitor_checkins(session_id,name,entry_path)
      SELECT ?,?,? WHERE (SELECT count(*) FROM visitor_checkins WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 minute')) < 60`)
      .bind(body.session_id, name, body.entry_path).run();
    if (!result.meta.changes) {
      const existing = await env.CHECKINS.prepare('SELECT session_id FROM visitor_checkins WHERE session_id = ?').bind(body.session_id).first();
      if (!existing) return reply({ detail: 'Too many check-ins. Please try again shortly.' }, 429);
    }
    return reply({ ok: true });
  } catch { return reply({ detail: 'Check-in is temporarily unavailable' }, 503); }
}
