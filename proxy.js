/**
 * smart-money.pdotcapital.workers.dev
 * Adds SIM_API_KEY header, keeps the path/query intact, adds CORS *.
 */
export default {
  async fetch(req, env) {
    const upstream = new URL(req.url);
    upstream.hostname = "api.sim.dune.com";       // Sim host
    upstream.pathname = upstream.pathname.replace(/^\/?v1/, "/v1");

    const simReq = new Request(upstream.toString(), req);
    simReq.headers.set("X-API-Key", env.SIM_API_KEY);

    const res = await fetch(simReq);

    const hdr = new Headers(res.headers);
    hdr.set("Access-Control-Allow-Origin", "*");  // allow any site
    return new Response(res.body, { ...res, headers: hdr });
  }
}
