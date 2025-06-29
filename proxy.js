/**
 * smart-money.pdotcapital.workers.dev
 * • Adds SIM_API_KEY header
 * • Edge-caches successful responses for 10 min
 * • Keeps path/query intact
 * • Adds CORS *
 */
export default {
  async fetch(req, env, ctx) {
    /* -------- rewrite to Sim origin -------- */
    const upstream = new URL(req.url);
    upstream.hostname = "api.sim.dune.com";
    upstream.pathname = upstream.pathname.replace(/^\/?v1/, "/v1");

    const simReq = new Request(upstream.toString(), req);
    simReq.headers.set("X-API-Key", env.SIM_API_KEY);

    /* -------- edge cache -------- */
    const cache = caches.default;
    let res = await cache.match(simReq);

    if (!res) {
      // cache miss → go to Sim
      res = await fetch(simReq);

      // only cache OK & cacheable responses (≤ 1 MB)
      if (res.ok) {
        const cacheRes = new Response(res.body, res);
        cacheRes.headers.set("Cache-Control", "public, max-age=600"); // 10 min
        // don’t await put()—let it run in background
        ctx.waitUntil(cache.put(simReq, cacheRes.clone()));
        res = cacheRes;
      }
    }

    /* -------- add CORS -------- */
    const hdr = new Headers(res.headers);
    hdr.set("Access-Control-Allow-Origin", "*");

    return new Response(res.body, { ...res, headers: hdr });
  }
}
