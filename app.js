/* ========= app.js  (balances + fast in/out counts) ========= */

const proxy = "https://smart-money.pdotcapital.workers.dev/v1";

const CHAINS = {
  ethereum : { id: 1,     scan: "https://etherscan.io/address/" },
  polygon  : { id: 137,   scan: "https://polygonscan.com/address/" },
  base     : { id: 8453,  scan: "https://basescan.org/address/" },
  optimism : { id: 10,    scan: "https://optimistic.etherscan.io/address/" },
  arbitrum : { id: 42161, scan: "https://arbiscan.io/address/" }
};

const LIMIT_HOLDERS   = 1000;   // top balances to show
const MAX_PAGES_TRANS = 20;     // scan ≤ 20k send/receive events

/* --- DOM refs --- */
const form  = document.getElementById("queryForm");
const tbl   = document.getElementById("balTable");
const tbody = tbl.querySelector("tbody");
const out   = document.getElementById("output");

/* === main handler === */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  tbl.hidden = true;
  tbody.innerHTML = "";
  out.textContent = "⏳ fetching holders…";

  try {
    /* validate inputs */
    const token  = document.getElementById("contract").value.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(token)) throw new Error("Invalid contract.");
    const chainKey = document.getElementById("chain").value;
    const { id: chainId, scan: scanBase } = CHAINS[chainKey];

    /* fetch holders + decimals in parallel */
    const holdersURL = `${proxy}/evm/token-holders/${chainId}/${token}?limit=${LIMIT_HOLDERS}`;
    const holdersP   = fetch(holdersURL).then(r => r.ok ? r.json() : r.text().then(Promise.reject));
    const decimalsP  = fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`)
                        .then(r => r.ok ? r.json() : null).catch(() => null);

    const [holdersJson, tokenInfo] = await Promise.all([holdersP, decimalsP]);
    const decimals = tokenInfo?.tokens?.[0]?.decimals ??
                     holdersJson.holders?.[0]?.decimals ?? 18;

    /* init stats map */
    const stats = new Map();                        // addr → {balance,inC,outC}
    holdersJson.holders.forEach(h => {
      stats.set(h.wallet_address.toLowerCase(), {
        balance: BigInt(h.balance),
        inC:  0,
        outC: 0
      });
    });
    const wantSet = new Set(stats.keys());

    /* scan token transfer feed (send/receive only) */
    out.textContent = "⏳ scanning transfers…";
    let url   = `${proxy}/evm/activity/${token}`
              + `?chain_ids=${chainId}&type=send,receive&limit=1000`;
    let pages = 0;
    while (url && pages < MAX_PAGES_TRANS) {
      const r = await fetch(url); if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      pages++;

      for (const ev of j.activity) {
        const from = (ev.from ?? ev.from_address ?? "").toLowerCase();
        const to   = (ev.to   ?? ev.to_address   ?? "").toLowerCase();
        if (wantSet.has(from)) stats.get(from).outC++;
        if (wantSet.has(to))   stats.get(to).inC++;
      }

      if (!j.next_offset) break;
      url = `${proxy}/evm/activity/${token}`
          + `?chain_ids=${chainId}&type=send,receive&limit=1000`
          + `&offset=${encodeURIComponent(j.next_offset)}`;
    }

    /* sort by balance desc */
    const rows = Array.from(stats.entries())
      .sort(([,a],[,b]) => a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1);

    /* render */
    rows.forEach(([addr, s]) => {
      const tr = tbody.insertRow();

      const a  = document.createElement("a");
      a.href   = scanBase + addr;
      a.target = "_blank";
      a.rel    = "noopener";
      a.textContent = addr;
      tr.insertCell().appendChild(a);

      tr.insertCell().textContent = fmt(s.balance, decimals);
      tr.insertCell().textContent = s.inC;
      tr.insertCell().textContent = s.outC;
    });

    tbl.hidden = false;
    out.textContent = `✅ ${rows.length} holders · pages scanned: ${pages}`;
  } catch (err) {
    console.error(err);
    out.textContent = `❌ ${err}`;
  }
});

/* === helper fns === */

function fmt(bigInt, dec) {
  const s = bigInt.toString().padStart(dec + 1, "0");
  const intPart  = s.slice(0, -dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fracPart = s.slice(-dec, -dec + 2).replace(/0+$/, "");
  return intPart + (fracPart ? "." + fracPart : "");
}
