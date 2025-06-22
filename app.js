/* =======================  app.js  ======================= */

/* --- CHANGE THIS to your Worker URL (keep /v1) --- */
const proxyBase = "https://smart-money.pdotcapital.workers.dev/v1";

const CHAIN_IDS = { ethereum: 1, polygon: 137, base: 8453, optimism: 10, arbitrum: 42161 };

const out  = document.getElementById("output");
const form = document.getElementById("queryForm");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  out.textContent = "⏳ Running…";

  try {
    /* ─────── collect inputs ─────── */
    const addr   = document.getElementById("contract").value.trim().toLowerCase();
    const chain  = document.getElementById("chain").value;
    const symbol = document.getElementById("symbol").value.trim();      // not used yet
    const range  = new FormData(form).get("range");

    const chainId = CHAIN_IDS[chain];
    if (!chainId) throw new Error(`Unknown chain “${chain}”`);

    /* ─────── work out dates ─────── */
    const nowISO  = new Date().toISOString();
    let   fromISO = "";
    if (range === "0") {                       // custom
      const from = document.getElementById("from").value;
      const to   = document.getElementById("to").value;
      if (!from || !to) throw new Error("Pick both custom dates");
      fromISO = new Date(from).toISOString();
      nowISO  = new Date(to).toISOString();
    } else {
      const days = +range;                     // 7,14,30
      fromISO = new Date(Date.now() - days * 864e5).toISOString();
    }

    /* ─────── build Sim URL ───────
       /evm/transactions supports ?from & ?to, good demo endpoint        */
    const url = `${proxyBase}/evm/transactions/${addr}` +
                `?chain_ids=${chainId}&from=${fromISO}&to=${nowISO}&limit=100`;

    /* ─────── call Sim via proxy ─────── */
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();

    out.textContent = JSON.stringify(json, null, 2);
  } catch (err) {
    console.error(err);
    out.textContent = `❌ ${err.message}`;
  }
});
