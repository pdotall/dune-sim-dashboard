/* =========  app.js  (Win-95 UI, ENS, bullet-proof logo, 1-page activity) ========= */

const proxy = "https://smart-money.pdotcapital.workers.dev/v1";

/* ---------- chain meta ---------- */
const CHAINS = {
  ethereum : { id: 1,     scan: "https://etherscan.io/address/" },
  polygon  : { id: 137,   scan: "https://polygonscan.com/address/" },
  base     : { id: 8453,  scan: "https://basescan.org/address/" },
  optimism : { id: 10,    scan: "https://optimistic.etherscan.io/address/" },
  arbitrum : { id: 42161, scan: "https://arbiscan.io/address/" }
};

/* ---------- speed knobs ---------- */
const TOP_CAP   = { 7: 250, 14: 250, 30: 250, all: 250 };
const WORKERS   = 5;      // still parallel, but each does only 1 page
const MAX_PAGES = 1;      // <= 1 *per holder* request

/* ---------- helpers ---------- */
const HEX40 = /^0x[a-f0-9]{40}$/i;

function fmt(bi, dec) {
  const s = bi.toString().padStart(dec + 1, "0");
  const int  = s.slice(0, -dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = s.slice(-dec, -dec + 2).replace(/0+$/, "");
  return int + (frac ? "." + frac : "");
}

function trustLogo(addr, chainKey) {
  try {
    const checksummed = ethers.utils.getAddress(addr);
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chainKey}/assets/${checksummed}/logo.png`;
  } catch { return ""; }
}

function logoHTML(primary, fallback, sym) {
  if (!primary && !fallback) return sym;
  const first = primary || fallback;
  const escF  = fallback.replace(/"/g, "&quot;");
  const onErr = fallback
    ? `onerror="if(this.src!=='${escF}'){this.src='${escF}';}else{this.style.display='none';}"`
    : `onerror="this.style.display='none'"`;
  return `<img src="${first}" style="width:16px;height:16px;border-radius:50%;vertical-align:middle" ${onErr}> ${sym}`;
}

/* ---------- ENS map (parsed once) ---------- */
const ensMapPromise = (async () => {
  try {
    const txt = await fetch("data/ens_map.csv").then(r => r.text());
    const map = new Map();
    txt.split(/\r?\n/).slice(1).forEach(l => {
      if (!l.trim()) return;
      const [o, n = ""] = l.split(/,(.+)/);
      if (o) map.set(o.trim().toLowerCase(), n.replace(/^\[|\]$/g,"").trim());
    });
    return map;
  } catch (e) { console.error("ENS CSV", e); return new Map(); }
})();

/* ---------- DOM ---------- */
const form      = document.getElementById("queryForm");
const addrInput = document.getElementById("contract");
const tbl       = document.getElementById("balTable");
const tbody     = tbl.querySelector("tbody");
const out       = document.getElementById("output");
const preview   = document.getElementById("tokenPreview");
const tokenLogo = document.getElementById("tokenLogo");
const tokenName = document.getElementById("tokenName");

/* ---------- live preview badge ---------- */
addrInput.addEventListener("blur", async () => {
  const addr = addrInput.value.trim().toLowerCase();
  if (!HEX40.test(addr)) return preview.classList.add("hidden");

  const chainKey = document.getElementById("chain").value;
  const chainId  = CHAINS[chainKey].id;

  try {
    const info = (await fetch(`${proxy}/evm/token-info/${addr}?chain_ids=${chainId}`)
                     .then(r => r.json())).tokens?.[0];
    if (!info) throw 0;

    const fall = trustLogo(addr, chainKey);
    tokenLogo.src = info.logo_url || fall;
    tokenLogo.style.display = "";
    tokenLogo.onerror = () => { tokenLogo.style.display = "none"; };
    tokenName.textContent = `${info.name} (${info.symbol})`;
    preview.classList.remove("hidden");
  } catch { preview.classList.add("hidden"); }
});

/* ---------- main ---------- */
form.addEventListener("submit", async e => {
  e.preventDefault();
  tbl.hidden = true; tbody.innerHTML = "";
  out.textContent = "⏳ fetching holders…";

  try {
    const token = addrInput.value.trim().toLowerCase();
    if (!HEX40.test(token)) throw new Error("Invalid contract address");

    const chainKey = document.getElementById("chain").value;
    const { id: chainId, scan: scanBase } = CHAINS[chainKey];

    const sel    = new FormData(form).get("range");
    const now    = Date.now();
    const fromMs = sel === "all" ? 0 : now - (+sel) * 864e5;
    const TOP_HOLDERS = TOP_CAP[sel];

    /* holders + meta in parallel */
    const [holdersJson, tokenInfo] = await Promise.all([
      fetch(`${proxy}/evm/token-holders/${chainId}/${token}?limit=${TOP_HOLDERS}`).then(r=>r.json()),
      fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`).then(r=>r.json())
    ]);

    const decimals = tokenInfo.tokens?.[0]?.decimals ?? 18;
    const symbol   = tokenInfo.tokens?.[0]?.symbol   ?? "";
    const simLogo  = tokenInfo.tokens?.[0]?.logo_url ?? "";
    const fallbackLogo = trustLogo(token, chainKey);

    /* base stat rows */
    const stats = new Map();
    holdersJson.holders.forEach(h => {
      stats.set(h.wallet_address.toLowerCase(), {
        bal: BigInt(h.balance),
        inC: 0, outC: 0,
        inAmt: 0n, outAmt: 0n
      });
    });

    /* queue + workers (1 page per addr) */
    const queue = [...stats.keys()];

    async function worker() {
      while (queue.length) {
        const addr = queue.pop();
        const s    = stats.get(addr);

        const url = `${proxy}/evm/activity/${addr}`
          + `?chain_ids=${chainId}&type=send,receive,mint,burn&limit=250`;
        const r = await fetch(url); if (!r.ok) { console.error(await r.text()); continue; }
        const { activity } = await r.json();

        activity.forEach(ev => {
          const ts = Date.parse(ev.block_time);
          if (ts < fromMs) return;
          if (ev.asset_type !== "erc20" || ev.token_address.toLowerCase() !== token) return;

          const val = BigInt(ev.value);
          if (["send","burn"].includes(ev.type)) { s.outC++; s.outAmt += val; }
          if (["receive","mint"].includes(ev.type)) { s.inC++; s.inAmt += val; }
        });

        out.textContent = `⏳ processed ${TOP_HOLDERS - queue.length}/${TOP_HOLDERS}`;
      }
    }

    await Promise.all(Array.from({ length: WORKERS }, worker));

    /* render */
    const ensMap = await ensMapPromise;
    const rows = Array.from(stats.entries())
      .sort(([,a],[,b]) => Number(b.bal - a.bal))
      .filter(([,s]) => s.inC || s.outC);   // show only addresses with activity

    rows.forEach(([addr, s]) => {
      const tr = tbody.insertRow();
      const a  = document.createElement("a");
      a.href = scanBase + addr; a.textContent = addr; a.target="_blank"; a.rel="noopener";
      tr.insertCell().appendChild(a);

      tr.insertCell().textContent = ensMap.get(addr) || "";
      tr.insertCell().textContent = fmt(s.bal, decimals);
      tr.insertCell().textContent = s.inC;
      tr.insertCell().textContent = fmt(s.inAmt, decimals);
      tr.insertCell().textContent = s.outC;
      tr.insertCell().textContent = fmt(s.outAmt, decimals);
      tr.insertCell().innerHTML  = logoHTML(simLogo, fallbackLogo, symbol);
    });

    tbl.hidden = false;
    out.textContent = `✅ ${rows.length} holders scanned`;
  } catch (err) {
    console.error(err);
    out.textContent = `❌ ${err}`;
  }
});
