/* ========= app.js  (bug-fixed) ========= */

const proxyBase = "https://smart-money.pdotcapital.workers.dev/v1";
const CHAIN_IDS = { ethereum: 1, polygon: 137, base: 8453, optimism: 10, arbitrum: 42161 };

const out  = document.getElementById("output");
const form = document.getElementById("queryForm");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  out.textContent = "⏳ Running…";

  try {
    /* collect inputs */
    const addr   = document.getElementById("contract").value.trim().toLowerCase();
    const chain  = document.getElementById("chain").value;
    const chainId = CHAIN_IDS[chain];
    if (!chainId) throw new Error(`Unknown chain “${chain}”`);

    /* dates */
    const range = new FormData(form).get("range");   // "7", "14", "30", "0"
    let fromISO, toISO = new Date().toISOString();   // toISO is *let* now

    if (range === "0") {                             // custom
      const from = document.getElementById("from").value;
      const to   = document.getElementById("to").value;
      if (!from || !to) throw new Error("Pick both custom dates");
      fromISO = new Date(from).toISOString();
      toISO   = new Date(to).toISOString();          // ok to reassign
    } else {
      const days = +range;                           // number of days
      fromISO = new Date(Date.now() - days * 864e5).toISOString();
    }

    /* build Sim URL (transactions endpoint supports dates) */
    const url =
      `${proxyBase}/evm/transactions/${addr}` +
      `?chain_ids=${chainId}&from=${fromISO}&to=${toISO}&limit=100`;

    /* call Sim via Worker */
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();

    out.textContent = JSON.stringify(json, null, 2);
  } catch (err) {
    console.error(err);
    out.textContent = `❌ ${err.message}`;
  }
});
