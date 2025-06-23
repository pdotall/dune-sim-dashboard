/* ========= app.js ========= */

const proxyBase = "https://smart-money.pdotcapital.workers.dev/v1";

/* chain name → numeric chain_id */
const CHAIN_IDS = {
  ethereum: 1,
  polygon: 137,
  base: 8453,
  optimism: 10,
  arbitrum: 42161
};

const out     = document.getElementById("output");
const form    = document.getElementById("queryForm");
const txTable = document.getElementById("txTable");
const tbody   = txTable.querySelector("tbody");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  out.textContent = "⏳ Fetching…";
  txTable.hidden  = true;
  tbody.innerHTML = "";

  try {
    /* ---------- collect & validate ---------- */
    const addrInput = document.getElementById("contract");
    if (!addrInput.checkValidity()) throw new Error("Enter a valid 0x address.");
    const addr    = addrInput.value.trim().toLowerCase();

    const chain   = document.getElementById("chain").value;
    const chainId = CHAIN_IDS[chain];
    if (!chainId) throw new Error(`Unknown chain “${chain}”`);

    /* ---------- client-side date window ---------- */
    const range = new FormData(form).get("range");          // "7" | "14" | "30" | "0"
    let fromMs = 0, toMs = Date.now();
    if (range === "0") {                                    // custom
      const from = document.getElementById("from").value;
      const to   = document.getElementById("to").value;
      if (!from || !to) throw new Error("Pick both custom dates.");
      fromMs = new Date(from).getTime();
      toMs   = new Date(to).getTime();
    } else {
      fromMs = Date.now() - (+range) * 864e5;
    }

    /* ---------- fetch pages ---------- */
    let url = `${proxyBase}/evm/transactions/${addr}?chain_ids=${chainId}&limit=100`;
    const all = [];

    while (url) {
      console.log("Fetching:", url);                        // debug
      const res = await fetch(url);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${res.status} ${res.statusText} – ${txt.slice(0,120)}`);
      }
      const json = await res.json();
      all.push(...json.transactions);

      const next = json.next_offset;
      if (!next) break;
      const oldest = json.transactions.at(-1);
      if (new Date(oldest.block_time).getTime() < fromMs) break;
      url = `${proxyBase}/evm/transactions/${addr}?chain_ids=${chainId}&limit=100&offset=${encodeURIComponent(next)}`;
    }

    /* ---------- filter + render ---------- */
    const filtered = all.filter(t => {
      const ts = new Date(t.block_time).getTime();
      return ts >= fromMs && ts <= toMs;
    });

    if (!filtered.length) throw new Error("No transactions in that window.");

    filtered.forEach(t => {
      const row = tbody.insertRow();
      row.insertCell().textContent = t.block_time.replace("T"," ").replace("Z","");
      row.insertCell().textContent = `${t.from.slice(0,6)}… → ${t.to.slice(0,6)}…`;
      row.insertCell().textContent = BigInt(t.value).toString();
      row.insertCell().textContent = t.hash.slice(0,10) + "…";
    });
    txTable.hidden  = false;
    out.textContent = `✅ ${filtered.length} tx shown (pulled ${all.length})`;
  } catch (err) {
    console.error(err);
    out.textContent = `❌ ${err.message}`;
  }
});
