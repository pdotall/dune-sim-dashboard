/* ========= app.js (accurate send/receive + swap counts) ========= */

const proxy = "https://smart-money.pdotcapital.workers.dev/v1";

/* per-chain scan links */
const CHAINS = {
  ethereum : { id: 1,     scan: "https://etherscan.io/address/" },
  polygon  : { id: 137,   scan: "https://polygonscan.com/address/" },
  base     : { id: 8453,  scan: "https://basescan.org/address/"   },
  optimism : { id: 10,    scan: "https://optimistic.etherscan.io/address/" },
  arbitrum : { id: 42161, scan: "https://arbiscan.io/address/"   }
};

const LIMIT_HOLDERS   = 1000;   // balances table
const MAX_PAGES_TRANS = 20;     // ≤20 k activity rows

/* DOM refs */
const form  = document.getElementById("queryForm");
const tbl   = document.getElementById("balTable");
const tbody = tbl.querySelector("tbody");
const out   = document.getElementById("output");

/* -------- main submit handler -------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  tbl.hidden = true;
  tbody.innerHTML = "";
  out.textContent = "⏳ fetching holders…";

  try {
    /* --- validate inputs --- */
    const token = document.getElementById("contract").value.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(token))
      throw new Error("Enter a valid 0x contract.");
    const chainKey   = document.getElementById("chain").value;
    const { id: chainId, scan: scanBase } = CHAINS[chainKey];

    /* --- holders + decimals in parallel --- */
    const holdersURL = `${proxy}/evm/token-holders/${chainId}/${token}?limit=${LIMIT_HOLDERS}`;
    const holdersP   = fetch(holdersURL).then(r => r.ok ? r.json()
                                                        : r.text().then(Promise.reject));
    const decP       = fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`)
                       .then(r => r.ok ? r.json() : null).catch(() => null);

    const [holdersJson, tokenInfo] = await Promise.all([holdersP, decP]);
    const decimals = tokenInfo?.tokens?.[0]?.decimals ??
                     holdersJson.holders?.[0]?.decimals ?? 18;

    /* --- pre-populate stats map --- */
    const stats = new Map();                    // addr → {balance,inC,outC,swapIn,swapOut}
    holdersJson.holders.forEach(h => {
      stats.set(h.wallet_address.toLowerCase(), {
        balance : BigInt(h.balance),
        inC     : 0,  outC   : 0,
        swapIn  : 0,  swapOut: 0
      });
    });
    const want = new Set(stats.keys());

    /* --- stream activity: send, receive, swap only --- */
    out.textContent = "⏳ scanning transfers…";
    let url   = `${proxy}/evm/activity/${token}`
              + `?chain_ids=${chainId}&type=send,receive,swap&limit=1000`;
    let pages = 0;

    while (url && pages < MAX_PAGES_TRANS) {
      const r = await fetch(url); if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      pages++;

      for (const ev of j.activity) {
        const from = (ev.from ?? ev.from_address ?? "").toLowerCase();
        const to   = (ev.to   ?? ev.to_address   ?? "").toLowerCase();

        /* ---- send / receive ---- */
        if (ev.asset_type === "erc20") {
          if (ev.type === "send"    && want.has(from)) stats.get(from).outC++;
          if (ev.type === "receive" && want.has(to))   stats.get(to).inC++;
        }

        /* ---- swap ---- */
        if (ev.type === "swap") {
          /* Sim provides arrays tokens_in / tokens_out: iterate & match token */
          (ev.tokens_in  || []).forEach(tok => {
            if (tok.token_address?.toLowerCase() === token && want.has(from))
              stats.get(from).swapOut++;
          });
          (ev.tokens_out || []).forEach(tok => {
            if (tok.token_address?.toLowerCase() === token && want.has(to))
              stats.get(to).swapIn++;
          });
        }
      }

      if (!j.next_offset) break;
      url = `${proxy}/evm/activity/${token}`
          + `?chain_ids=${chainId}&type=send,receive,swap&limit=1000`
          + `&offset=${encodeURIComponent(j.next_offset)}`;
    }

    /* --- render sorted by balance desc --- */
    const rows = Array.from(stats.entries())
      .sort(([,a],[,b]) => a.balance === b.balance ? 0
                                                   : a.balance > b.balance ? -1 : 1);

    rows.forEach(([addr, s]) => {
      const tr = tbody.insertRow();
      const link = document.createElement("a");
      link.href = scanBase + addr;
      link.target = "_blank"; link.rel = "noopener";
      link.textContent = addr;

      tr.insertCell().appendChild(link);
      tr.insertCell().textContent = fmt(s.balance, decimals);
      tr.insertCell().textContent = s.inC;
      tr.insertCell().textContent = s.outC;
      tr.insertCell().textContent = s.swapIn;
      tr.insertCell().textContent = s.swapOut;
    });

    tbl.hidden = false;
    out.textContent = `✅ ${rows.length} holders · pages scanned: ${pages}`;
  } catch (err) {
    console.error(err);
    out.textContent = `❌ ${err}`;
  }
});

/* ---------- helpers ---------- */
function fmt(bi, dec) {
  const s = bi.toString().padStart(dec + 1, "0");
  const int  = s.slice(0, -dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = s.slice(-dec, -dec + 2).replace(/0+$/, "");
  return int + (frac ? "." + frac : "");
}
