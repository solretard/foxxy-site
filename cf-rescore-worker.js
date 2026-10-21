// Cloudflare Worker — FOXXY rescore cron
// Paste this into a new Worker in the Cloudflare dashboard.
// Set these environment variables (Worker → Settings → Variables):
//   FOXXY_SITE_URL  →  https://your-vercel-domain.vercel.app  (or your custom domain)
//   RESCORE_SECRET  →  same value you set in Vercel env vars

export default {
  // Cron trigger fires this handler on schedule
  async scheduled(event, env, ctx) {
    ctx.waitUntil(rescore(env));
  },

  // Also allow manual trigger via GET https://your-worker.workers.dev/
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/trigger') {
      return new Response('FOXXY rescore worker. POST /trigger to run manually.', { status: 200 });
    }
    await rescore(env);
    return new Response('Rescore triggered.', { status: 200 });
  },
};

async function rescore(env) {
  const url    = (env.FOXXY_SITE_URL || '').replace(/\/$/, '') + '/api/rescore-all';
  const secret = env.RESCORE_SECRET || '';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-rescore-secret': secret,
      'Content-Type': 'application/json',
    },
  });

  const body = await res.text();
  console.log(`rescore-all → ${res.status}: ${body}`);
}
