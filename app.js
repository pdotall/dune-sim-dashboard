/* =========  app.js  (contract-level scan, ENS, logo fallback)  ========= */

const proxy = "https://smart-money.pdotcapital.workers.dev/v1";

/* ---------- chain meta ---------- */
const CHAINS = {
  ethereum : { id: 1,     scan: "https://etherscan.io/address/" },
  polygon  : { id: 137,   scan: "https://polygonscan.com/address/" },
  base     : { id: 8453,  scan: "https://basescan.org/address/" },
  optimism : { id: 10,    scan: "https://optimistic.etherscan.io/address/" },
  arbitrum : { id: 42161, scan: "https://arbiscan.io/address/" }
};

/* ---------- knobs ---------- */
const TOP_CAP  = { 7: 500, 14: 750, 30: 1000, all: 1000 };
const TX_LIMIT = 1000;    // how many transfers to pull per query

/* ---------- helpers ---------- */
function fmt(bi, dec) {
  const s = bi.toString().padStart(dec + 1, "0");
  const int  = s.slice(0, -dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = s.slice(-dec, -dec + 2).replace(/0+$/, "");
  return int + (frac ? "." + frac : "");
}

function trustLogo(addr, chain) {
  try {
    const c = ethers.utils.getAddress(addr); // checksum
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chain}/assets/${c}/logo.png`;
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

/* ---------- ENS map (CSV parsed once) ---------- */
const ensMapPromise = (async () => {
  try {
    const txt = await fetch("data/ens_map.csv").then(r=>r.text());
    const map = new Map();
    txt.split(/\r?\n/).slice(1).forEach(line=>{
      if(!line.trim()) return;
      const [o,n=""]=line.split(/,(.+)/);
      map.set(o.trim().toLowerCase(), n.replace(/^\[|\]$/g,"").trim());
    });
    return map;
  } catch(e){console.error("ENS CSV",e); return new Map();}
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
addrInput.addEventListener("blur", async()=>{
  const addr = addrInput.value.trim().toLowerCase();
  if(!/^0x[a-f0-9]{40}$/.test(addr)) return preview.classList.add("hidden");

  const chainKey = document.getElementById("chain").value;
  const chainId  = CHAINS[chainKey].id;

  try {
    const info = (await fetch(`${proxy}/evm/token-info/${addr}?chain_ids=${chainId}`)
                     .then(r=>r.json())).tokens?.[0];
    if(!info) throw 0;

    const fallback = trustLogo(addr, chainKey);
    tokenLogo.src = info.logo_url || fallback;
    tokenLogo.style.display="";
    tokenLogo.onerror = ()=>{ tokenLogo.style.display="none"; };
    tokenName.textContent=`${info.name} (${info.symbol})`;
    preview.classList.remove("hidden");
  } catch {
    preview.classList.add("hidden");
  }
});

/* ---------- main ---------- */
form.addEventListener("submit", async e=>{
  e.preventDefault();
  tbl.hidden = true; tbody.innerHTML = "";
  out.textContent = "⏳ fetching…";

  try{
    const token = addrInput.value.trim().toLowerCase();
    if(!/^0x[a-f0-9]{40}$/.test(token)) throw new Error("Invalid address");

    const chainKey = document.getElementById("chain").value;
    const { id: chainId, scan: scanBase } = CHAINS[chainKey];

    const sel    = new FormData(form).get("range");   // 7 | 14 | 30 | all
    const fromMs = sel === "all" ? 0 : Date.now() - (+sel)*864e5;

    /* get token meta + transfers in parallel */
    const [meta, { activity }] = await Promise.all([
      fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`).then(r=>r.ok?r.json():null).catch(()=>null),
      fetch(`${proxy}/evm/activity/${token}?chain_ids=${chainId}&type=transfer&limit=${TX_LIMIT}`).then(r=>r.json())
    ]);

    const decimals = meta?.tokens?.[0]?.decimals ?? 18;
    const symbol   = meta?.tokens?.[0]?.symbol   ?? "";
    const simLogo  = meta?.tokens?.[0]?.logo_url ?? "";
    const fallbackLogo = trustLogo(token, chainKey);

    /* build stats from transfers in window */
    const stats = new Map();
    activity.filter(t=>Date.parse(t.block_time) >= fromMs).forEach(t=>{
      const val = BigInt(t.value);
      const f   = t.from_address.toLowerCase();
      const to  = t.to_address.toLowerCase();

      if(!stats.has(f))  stats.set(f ,{bal:0n,inC:0,outC:0,inAmt:0n,outAmt:0n});
      if(!stats.has(to)) stats.set(to,{bal:0n,inC:0,outC:0,inAmt:0n,outAmt:0n});

      stats.get(f ).outC++; stats.get(f ).outAmt += val; stats.get(f ).bal -= val;
      stats.get(to).inC ++; stats.get(to).inAmt  += val; stats.get(to).bal += val;
    });

    const rows = Array.from(stats.entries())
      .sort(([,a],[,b])=> Number(b.bal - a.bal))
      .slice(0, TOP_CAP[sel]);

    const ensMap = await ensMapPromise;

    /* render */
    rows.forEach(([addr,s])=>{
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

    tbl.hidden=false;
    out.textContent=`✅ ${rows.length} holders`;
  }catch(err){
    console.error(err);
    out.textContent="❌ "+err;
  }
});
