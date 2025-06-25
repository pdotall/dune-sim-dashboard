/* ========= app.js  (balances + in/out counts) ========= */

const proxy = "https://smart-money.pdotcapital.workers.dev/v1";
const CHAINS = {
  ethereum : { id:1,    scan:"https://etherscan.io/address/" },
  polygon  : { id:137,  scan:"https://polygonscan.com/address/" },
  base     : { id:8453, scan:"https://basescan.org/address/" },
  optimism : { id:10,   scan:"https://optimistic.etherscan.io/address/" },
  arbitrum : { id:42161,scan:"https://arbiscan.io/address/" }
};
const LIMIT_HOLDERS  = 1000;   // top N balances
const LIMIT_ACTIVITY = 5000;   // safety cap = first 5k transfers (few seconds)

const form  = document.getElementById("queryForm");
const tbl   = document.getElementById("balTable");
const tbody = tbl.querySelector("tbody");
const out   = document.getElementById("output");

form.addEventListener("submit", async e => {
  e.preventDefault();
  tbl.hidden = true; tbody.innerHTML = "";
  out.textContent = "⏳ fetching holders…";

  try {
    /* inputs */
    const token = document.getElementById("contract").value.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(token)) throw new Error("Invalid contract.");
    const chainKey = document.getElementById("chain").value;
    const { id: chainId, scan: scanBase } = CHAINS[chainKey];

    /* holders & decimals in parallel */
    const holdersP = fetch(`${proxy}/evm/token-holders/${chainId}/${token}?limit=${LIMIT_HOLDERS}`)
                       .then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(t)));
    const tokenInfoP = fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`)
                       .then(r => r.ok ? r.json() : null).catch(() => null);

    const [holdersJson, tokenInfo] = await Promise.all([holdersP, tokenInfoP]);

    const decimals =
      tokenInfo?.tokens?.[0]?.decimals ??
      holdersJson.holders?.[0]?.decimals ?? 18;

    /* build lookup for quick count aggregation */
    const holdersMap = new Map();     // addr → stats obj
    holdersJson.holders.forEach(h => {
      holdersMap.set(h.wallet_address.toLowerCase(), {
        balance: BigInt(h.balance),
        inC : 0,
        outC: 0
      });
    });

    /* scan token transfer feed once */
    out.textContent = "⏳ scanning transfers…";
    let url  = `${proxy}/evm/activity/${token}?chain_ids=${chainId}&limit=1000`;
    let seen = 0;
    while (url && seen < LIMIT_ACTIVITY) {
      const r = await fetch(url); if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      for (const ev of j.activity) {
        if (ev.asset_type !== "erc20") continue;
        const from = (ev.from ?? ev.from_address ?? "").toLowerCase();
        const to   = (ev.to   ?? ev.to_address   ?? "").toLowerCase();

        if (holdersMap.has(from)) holdersMap.get(from).outC++;
        if (holdersMap.has(to))   holdersMap.get(to).inC++;
      }
      seen += j.activity.length;
      url = j.next_offset
        ? `${proxy}/evm/activity/${token}?chain_ids=${chainId}&limit=1000&offset=${encodeURIComponent(j.next_offset)}`
        : null;
    }

    /* final sorted list */
    const rows = Array.from(holdersMap.entries())
      .sort(([,a],[,b]) => (a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1))
      .map(([addr, s]) => ({ addr, ...s }));

    /* render */
    rows.forEach(r => {
      const tr = tbody.insertRow();
      const a  = document.createElement("a");
      a.href   = scanBase + r.addr;
      a.target = "_blank"; a.rel = "noopener";
      a.textContent = r.addr;
      tr.insertCell().appendChild(a);
      tr.insertCell().textContent = fmt(r.balance, decimals);
      tr.insertCell().textContent = r.inC;
      tr.insertCell().textContent = r.outC;
    });

    tbl.hidden = false;
    out.textContent = `✅ ${rows.length} holders · transfers scanned: ${seen}`;
  } catch (err) {
    console.error(err);
    out.textContent = `❌ ${err}`;
  }
});

/* ---------- helpers ---------- */

function fmt(big, dec) {
  const s = big.toString().padStart(dec + 1, "0");
  const int  = s.slice(0, -dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = s.slice(-dec, -dec + 2).replace(/0+$/, "");
  return int + (frac ? "." + frac : "");
}
