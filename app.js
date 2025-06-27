/* =========  app.js  (Win 95 UI + robust logo with auto-fallback)  ========= */

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
const TOP_CAP   = { all: 1000, 30: 1000, 14: 750, 7: 500 };
const WORKERS   = 5;
const MAX_PAGES = 5;

/* ---------- helpers ---------- */
function fmt(bigInt, dec) {
  const s = bigInt.toString().padStart(dec + 1, "0");
  const int  = s.slice(0, -dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = s.slice(-dec, -dec + 2).replace(/0+$/, "");
  return int + (frac ? "." + frac : "");
}

/* Build a TrustWallet fallback path (Ethereum only) */
function trustLogo(addr, chainKey) {
  if (chainKey !== "ethereum") return "";
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${addr}/logo.png`;
}

/* Generate <img …> HTML with JS-injected onerror for auto-fallback */
function logoHTML(primary, fallback, sym) {
  if (!primary && !fallback) return sym;          // nothing to show
  const first = primary || fallback;
  const escF  = fallback.replace(/"/g, '&quot;'); // safe for attr
  const onErr = fallback
    ? `onerror="if(this.src!=='${escF}'){this.src='${escF}';}else{this.style.display='none';}"`
    : `onerror="this.style.display='none'"`;
  return `<img src="${first}" style="width:16px;height:16px;border-radius:50%;vertical-align:middle" ${onErr}> ${sym}`;
}

/* ---------- ENS map (loaded once – no external libs) ---------- */
const ensMapPromise = (async () => {
  try {
    const txt = await fetch("data/ens_map.csv").then(r => r.text());
    const map = new Map();
    txt.split(/\r?\n/).slice(1).forEach(line => {
      if (!line.trim()) return;
      const [ownerRaw, nameRaw = ""] = line.split(/,(.+)/); // split once
      if (!ownerRaw) return;
      const owner = ownerRaw.trim().toLowerCase();
      const name  = nameRaw.replace(/^\[|\]$/g, "").trim();
      map.set(owner, name);
    });
    return map;
  } catch (err) {
    console.error("ENS CSV load failed:", err);
    return new Map();
  }
})();

/* ---------- DOM refs ---------- */
const form       = document.getElementById("queryForm");
const addrInput  = document.getElementById("contract");
const tbl        = document.getElementById("balTable");
const tbody      = tbl.querySelector("tbody");
const out        = document.getElementById("output");
const preview    = document.getElementById("tokenPreview");
const tokenLogo  = document.getElementById("tokenLogo");
const tokenName  = document.getElementById("tokenName");

/* ---------- live preview badge ---------- */
addrInput.addEventListener("blur", async () => {
  const addr = addrInput.value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return preview.classList.add("hidden");

  const chainKey = document.getElementById("chain").value;
  const chainId  = CHAINS[chainKey].id;

  try {
    const r    = await fetch(`${proxy}/evm/token-info/${addr}?chain_ids=${chainId}`);
    const info = (await r.json()).tokens?.[0];
    if (!info) throw new Error();

    const fallback = trustLogo(addr, chainKey);
    const primary  = info.logo_url || fallback;

    tokenLogo.src = primary;
    tokenLogo.style.display = ""; // reset
    tokenLogo.onerror = () => {
      if (fallback && tokenLogo.src !== fallback) {
        tokenLogo.onerror = null;
        tokenLogo.src = fallback;
      } else {
        tokenLogo.style.display = "none";
      }
    };

    tokenLogo.alt = info.symbol;
    tokenName.textContent = `${info.name} (${info.symbol})`;
    preview.classList.remove("hidden");
  } catch {
    preview.classList.add("hidden");
  }
});

/* ---------- main ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  tbl.hidden = true;
  tbody.innerHTML = "";
  out.textContent = "⏳ fetching holders…";

  try {
    /* validate input */
    const token = addrInput.value.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(token))
      throw new Error("Invalid contract address.");

    const chainKey = document.getElementById("chain").value;
    const { id: chainId, scan: scanBase } = CHAINS[chainKey];

    /* wait for ENS map */
    const ensMap = await ensMapPromise;

    /* time window */
    const sel    = new FormData(form).get("range");
    const now    = Date.now();
    const fromMs = sel === "all" ? 0 : now - (+sel) * 864e5;
    const TOP_HOLDERS = TOP_CAP[sel];

    /* fetch holders + token-info in parallel */
    const holdersURL = `${proxy}/evm/token-holders/${chainId}/${token}?limit=${TOP_HOLDERS}`;
    const [holdersJson, tokenInfo] = await Promise.all([
      fetch(holdersURL).then(r => r.ok ? r.json() : r.text().then(Promise.reject)),
      fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`)
        .then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    const decimals = tokenInfo?.tokens?.[0]?.decimals ??
                     holdersJson.holders?.[0]?.decimals ?? 18;
    const symbol   = tokenInfo?.tokens?.[0]?.symbol ?? "";

    const simLogo  = tokenInfo?.tokens?.[0]?.logo_url || "";
    const fallbackLogo = trustLogo(token, chainKey);

    /* stats map */
    const stats = new Map();
    holdersJson.holders.forEach(h => {
      stats.set(h.wallet_address.toLowerCase(), {
        balance: BigInt(h.balance),
        inC : 0, outC : 0,
        inAmt : 0n, outAmt : 0n
      });
    });

    /* worker queue */
    const queue = [...stats.keys()];

    async function worker() {
      while (queue.length) {
        const addr = queue.pop();
        const s    = stats.get(addr);

        let pages = 0;
        let limit = 250;
        let url   = `${proxy}/evm/activity/${addr}`
                  + `?chain_ids=${chainId}&type=send,receive,mint,burn&limit=${limit}`;

        while (url && pages < MAX_PAGES) {
          const r = await fetch(url);
          if (!r.ok) { console.error(await r.text()); break; }

          const { activity, next_offset } = await r.json();
          pages++;

          for (const ev of activity) {
            const ts = new Date(ev.block_time).getTime();
            if (ts < fromMs) { url = null; break; }

            if (ev.asset_type === "erc20" &&
                ev.token_address.toLowerCase() === token) {

              const val = BigInt(ev.value);
              if (["send", "burn"].includes(ev.type))   { s.outC++; s.outAmt += val; }
              if (["receive", "mint"].includes(ev.type)){ s.inC++;  s.inAmt  += val; }
            }
          }

          if (!next_offset) break;
          limit = 1000;
          url   = `${proxy}/evm/activity/${addr}`
                + `?chain_ids=${chainId}&type=send,receive,mint,burn&limit=${limit}`
                + `&offset=${encodeURIComponent(next_offset)}`;
        }
        out.textContent = `⏳ processed ${TOP_HOLDERS - queue.length}/${TOP_HOLDERS}`;
      }
    }

    await Promise.all(Array.from({ length: WORKERS }, worker));

    /* render rows */
    const rows = Array.from(stats.entries())
      .filter(([, s]) => !(s.inC === 0 && s.outC === 0))
      .sort(([, a], [, b]) => a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1);

    rows.forEach(([addr, s]) => {
      const tr = tbody.insertRow();

      /* Owner link */
      const a = document.createElement("a");
      a.href = scanBase + addr;
      a.textContent = addr;
      a.target = "_blank";
      a.rel = "noopener";
      tr.insertCell().appendChild(a);

      /* ENS */
      tr.insertCell().textContent = ensMap.get(addr) || "";

      tr.insertCell().textContent = fmt(s.balance, decimals);
      tr.insertCell().textContent = s.inC;
      tr.insertCell().textContent = fmt(s.inAmt, decimals);
      tr.insertCell().textContent = s.outC;
      tr.insertCell().textContent = fmt(s.outAmt, decimals);

      /* Token logo + symbol */
      const tokenCell = tr.insertCell();
      tokenCell.innerHTML = logoHTML(simLogo, fallbackLogo, symbol);
    });

    tbl.hidden = false;
    out.textContent = `✅ ${rows.length} holders scanned`;
  } catch (err) {
    console.error(err);
    out.textContent = `❌ ${err}`;
  }
});
