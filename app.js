/* ========= app.js  (per-holder activity scan, capped) ========= */

const proxy = "https://smart-money.pdotcapital.workers.dev/v1";

const CHAINS = {
  ethereum : { id: 1,     scan: "https://etherscan.io/address/" },
  polygon  : { id: 137,   scan: "https://polygonscan.com/address/" },
  base     : { id: 8453,  scan: "https://basescan.org/address/" },
  optimism : { id: 10,    scan: "https://optimistic.etherscan.io/address/" },
  arbitrum : { id: 42161, scan: "https://arbiscan.io/address/" }
};

/* Tweak these for speed vs. coverage */
const TOP_N       = 200;   // scan only biggest N holders
const CONCURRENCY = 5;     // simultaneous API calls (free tier = 5 RPS max)
const DAYS_WINDOW = 30;    // ignore events older than this

/* DOM refs */
const form  = document.getElementById("queryForm");
const tbl   = document.getElementById("balTable");
const tbody = tbl.querySelector("tbody");
const out   = document.getElementById("output");

/* ---------- main ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  tbl.hidden = true;
  tbody.innerHTML = "";
  out.textContent = "⏳ fetching holders…";

  try {
    /* --- inputs --- */
    const token = document.getElementById("contract").value.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(token)) throw new Error("Invalid contract.");
    const chainKey         = document.getElementById("chain").value;
    const { id: chainId, scan: scanBase } = CHAINS[chainKey];

    /* --- holders + decimals in parallel --- */
    const holdersURL = `${proxy}/evm/token-holders/${chainId}/${token}?limit=${TOP_N}`;
    const holdersP   = fetch(holdersURL).then(r => r.ok ? r.json()
                                                        : r.text().then(Promise.reject));
    const decP       = fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`)
                       .then(r => r.ok ? r.json() : null).catch(() => null);

    const [holdersJson, tokenInfo] = await Promise.all([holdersP, decP]);
    const decimals = tokenInfo?.tokens?.[0]?.decimals ??
                     holdersJson.holders?.[0]?.decimals ?? 18;

    /* --- stats map --- */
    const stats = new Map();          // addr → {balance,inC,outC,swapIn,swapOut}
    holdersJson.holders.forEach(h => {
      stats.set(h.wallet_address.toLowerCase(), {
        balance : BigInt(h.balance),
        inC     : 0, outC   : 0,
        swapIn  : 0, swapOut: 0
      });
    });

    /* queue & worker pool */
    const queue = [...stats.keys()];        // array of lowercase addresses
    const msWindow = DAYS_WINDOW * 864e5;
    const now      = Date.now();

    async function worker() {
      while (queue.length) {
        const addr = queue.pop();
        const s    = stats.get(addr);

        const url = `${proxy}/evm/activity/${addr}`
                  + `?chain_ids=${chainId}&limit=250&type=send,receive,swap`;
        const r   = await fetch(url);
        if (!r.ok) { console.error(await r.text()); continue; }
        const { activity } = await r.json();

        for (const ev of activity) {
          if (now - new Date(ev.block_time).getTime() > msWindow) break;

          /* --- send / receive of THIS token --- */
          if (ev.asset_type === "erc20" && ev.token_address.toLowerCase() === token) {
            if (ev.type === "send")    s.outC++;
            if (ev.type === "receive") s.inC++;
          }

          /* --- swap: token appears in tokens_in / tokens_out --- */
          if (ev.type === "swap") {
            (ev.tokens_out || []).forEach(t => {
              if (t.token_address?.toLowerCase() === token) s.swapIn++;
            });
            (ev.tokens_in  || []).forEach(t => {
              if (t.token_address?.toLowerCase() === token) s.swapOut++;
            });
          }
        }
        out.textContent = `⏳ scanned ${TOP_N - queue.length}/${TOP_N} holders`;
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    /* --- render table sorted by balance --- */
    const rows = Array.from(stats.entries())
      .sort(([,a],[,b]) => a.balance===b.balance ? 0 : a.balance>b.balance ? -1 : 1);

    rows.forEach(([addr, s]) => {
      const tr = tbody.insertRow();
      const link = document.createElement("a");
      link.href = scanBase + addr;
      link.target = "_blank"; link.rel = "noopener";
      link.textContent = addr;

      tr.insertCell().appendChild(link);
      tr.insertCell().textContent = format(s.balance, decimals);
      tr.insertCell().textContent = s.inC;
      tr.insertCell().textContent = s.outC;
      tr.insertCell().textContent = s.swapIn;
      tr.insertCell().textContent = s.swapOut;
    });

    tbl.hidden = false;
    out.textContent = `✅ completed (${rows.length} holders, ${DAYS_WINDOW} d window)`;
  } catch (err) {
    console.error(err);
    out.textContent = `❌ ${err}`;
  }
});

/* ---------- helpers ---------- */
function format(bi, dec) {
  const s = bi.toString().padStart(dec + 1, "0");
  const int  = s.slice(0, -dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = s.slice(-dec, -dec + 2).replace(/0+$/, "");
  return int + (frac ? "." + frac : "");
}
