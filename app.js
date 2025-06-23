/* ========= holder-stats app.js ========= */

const proxy = "https://smart-money.pdotcapital.workers.dev/v1";
const CHAIN_IDS = { ethereum:1, polygon:137, base:8453, optimism:10, arbitrum:42161 };

const form   = document.getElementById("queryForm");
const out    = document.getElementById("output");
const tbl    = document.getElementById("txTable");
const tbody  = tbl.querySelector("tbody");
const sizeBar= document.getElementById("pageSizeBar");   // we keep pagination UI
const pager  = document.getElementById("pager");
sizeBar.hidden = pager.hidden = true;                    // disable row paging for now

/* ───────────────────────────────────────────── */

form.addEventListener("submit", async (e)=>{
  e.preventDefault();
  tbody.innerHTML = "";  tbl.hidden = true;
  out.textContent = "⏳ Loading holders…";

  try {
    /* inputs & basics */
    const addrField = document.getElementById("contract");
    if (!addrField.checkValidity()) throw new Error("Enter a valid 0x address.");
    const token   = addrField.value.toLowerCase();
    const chainId = CHAIN_IDS[document.getElementById("chain").value];
    const range   = new FormData(form).get("range");              // "7"|"14"|"30"|"0"
    const nowMs   = Date.now();
    let  fromMs   = 0, toMs = nowMs;
    if (range === "0") {
      const from = new Date(document.getElementById("from").value).getTime();
      const to   = new Date(document.getElementById("to").value).getTime();
      if (!from || !to) throw new Error("Pick both custom dates.");
      fromMs = from;  toMs = to;
    } else {
      fromMs = nowMs - (+range)*864e5;
    }

    /* ---------- 1. pull ALL holders (first 500 for demo) ---------- */
    const holders = [];
    let hURL = `${proxy}/evm/token-holders/${chainId}/${token}?limit=100`;
    while (hURL && holders.length < 500) {                        // cap for demo
      const res = await fetch(hURL); if (!res.ok) throw new Error(await res.text());
      const j   = await res.json();
      holders.push(...j.holders);
      hURL = j.next_offset
        ? `${proxy}/evm/token-holders/${chainId}/${token}?limit=100&offset=${encodeURIComponent(j.next_offset)}`
        : null;
    }
    out.textContent = `⏳ ${holders.length} holders fetched – aggregating activity…`;

    /* ---------- 2. for each holder, fetch activity & summarise ---------- */
    const limit = 3;                   // concurrent fetches
    const queue = holders.slice();
    const results = [];

    async function worker(){
      while(queue.length){
        const h = queue.pop();
        const stats = await fetchStats(h.wallet_address);
        results.push({
          owner: h.wallet_address.toLowerCase(),
          balance: BigInt(h.balance),  // raw wei, decimals later
          inCount: stats.inCount,
          inAmount: stats.inAmount,
          outCount: stats.outCount,
          outAmount: stats.outAmount
        });
        out.textContent = `⏳ processed ${results.length}/${holders.length}`;
      }
    }

    await Promise.all(Array.from({length:limit}, worker));

    /* ---------- 3. render ---------- */
    results.sort((a,b)=> Number(b.balance - a.balance));
    tbody.innerHTML = "";
    const dec = await lookupDecimals(token, chainId);
    results.forEach(r=>{
      const row = tbody.insertRow();
      row.insertCell().textContent = r.owner.slice(0,10) + "…";
      row.insertCell().textContent = format(BigInt(r.balance), dec);
      row.insertCell().textContent = r.inCount;
      row.insertCell().textContent = format(r.inAmount, dec);
      row.insertCell().textContent = r.outCount;
      row.insertCell().textContent = format(r.outAmount, dec);
    });
    tbl.hidden = false;
    out.textContent = `✅ done – ${results.length} rows`;
  } catch(err){ console.error(err); out.textContent = `❌ ${err.message}`; }
});

/* ── helpers ────────────────────────────────────────── */

async function fetchStats(wallet){
  let url = `${proxy}/evm/activity/${wallet}?limit=250`;
  let inC=0n,inAmt=0n,outC=0n,outAmt=0n;

  while(url){
    const r = await fetch(url); if(!r.ok) throw new Error("activity "+await r.text());
    const j = await r.json();
    for(const a of j.activity){
      const ts = new Date(a.block_time).getTime();
      if (ts < fromMs) return {inCount: Number(inC), outCount:Number(outC),
                               inAmount: inAmt, outAmount: outAmt};
      if (ts>toMs) continue;
      if (a.asset_type!=="erc20" || a.token_address.toLowerCase()!==token) continue;

      if (a.type==="receive"){ inC++; inAmt += BigInt(a.value); }
      else if (a.type==="send"){ outC++; outAmt += BigInt(a.value); }
    }
    url = j.next_offset
      ? `${proxy}/evm/activity/${wallet}?limit=250&offset=${encodeURIComponent(j.next_offset)}`
      : null;
  }
  return {inCount: Number(inC), outCount:Number(outC), inAmount: inAmt, outAmount: outAmt};
}

async function lookupDecimals(token, chainId){
  const res = await fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`);
  if(!res.ok){ console.warn("token-info failed"); return 18; }
  const j = await res.json();
  return j.tokens?.[0]?.decimals ?? 18;
}

function format(big, dec){
  const s = big.toString().padStart(dec+1,"0");
  const int = s.slice(0, -dec);
  const frac= s.slice(-dec, -dec+2).replace(/0+$/,"");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g,",") + (frac? "."+frac :"");
}
