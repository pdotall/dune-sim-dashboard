/**
 * Cloudflare Worker proxy for Dune Sim
 * - rewrites the host to api.sim.dune.com
 * - injects X-API-Key from secret SIM_API_KEY
 * - adds permissive CORS header so any site can fetch it
 */
export default {
  async fetch(req, env) {
    // keep original path/query, swap host
    const upstream = new URL(req.url);
    upstream.hostname = "api.sim.dune.com";
    upstream.pathname = upstream.pathname.replace(/^\/?v1/, "/v1"); // ensure /v1 prefix stays

    // clone request and inject key
    const simReq = new Request(upstream.toString(), req);
    simReq.headers.set("X-API-Key", env.SIM_API_KEY);

    // forward to Sim
    const res = await fetch(simReq);

    // add CORS
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(res.body, { ...res, headers });
  }
}
