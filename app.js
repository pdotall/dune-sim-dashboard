/* ========= app.js  (adds Amount In / Amount Out) ========= */

const proxy = "https://smart-money.pdotcapital.workers.dev/v1";
const CHAINS = {
  ethereum : { id: 1,     scan: "https://etherscan.io/address/" },
  polygon  : { id: 137,   scan: "https://polygonscan.com/address/" },
  base     : { id: 8453,  scan: "https://basescan.org/address/" },
  optimism : { id: 10,    scan: "https://optimistic.etherscan.io/address/" },
  arbitrum : { id: 42161, scan: "https://arbiscan.io/address/" }
};

/* knobs */
const TOP_HOLDERS          = 100;
const WORKERS              = 5;
const MAX_PAGES_PER_HOLDER = 3;

/* DOM */
const form  = document.getElementById("queryForm");
const tbl   = document.getElementById("balTable");
const tbody = tbl.querySelector("tbody");
const out   = document.getElementById("output");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  tbl.hidden = true;
  tbody.innerHTML = "";
  out.textContent = "⏳ fetching holders…";

  try {
    /* inputs */
    const token = document.getElementById("contract").value.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(token)) throw new Error("Invalid contract.");
    const chainKey = document.getElementById("chain").value;
    const { id: chainId, scan: scanBase } = CHAINS[chainKey];

    /* window */
    const sel  = new FormData(form).get("range");            // all | 7 | 14 | 30
    const now  = Date.now();
    const fromMs = sel === "all" ? 0 : now - (+sel) * 864e5;

    /* holders + decimals */
    const holdersURL = `${proxy}/evm/token-holders/${chainId}/${token}?limit=${TOP_HOLDERS}`;
    const holdersP   = fetch(holdersURL).then(r => r.ok ? r.json()
                                                        : r.text().then(Promise.reject));
    const decP       = fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`)
                       .then(r => r.ok ? r.json() : null).catch(()=>null);

    const [holdersJson, tokenInfo] = await Promise.all([holdersP, decP]);
    const decimals = tokenInfo?.tokens?.[0]?.decimals ??
                     holdersJson.holders?.[0]?.decimals ?? 18;

    /* stats map */
    const stats = new Map();  // addr → {balance,inC,outC,inAmt,outAmt}
    holdersJson.holders.forEach(h=>{
      stats.set(h.wallet_address.toLowerCase(), {
        balance : BigInt(h.balance),
        inC : 0,  outC : 0,
        inAmt : 0n, outAmt : 0n
      });
    });

    /* queue workers */
    const queue = [...stats.keys()];
    async function worker(){
      while(queue.length){
        const addr = queue.pop();
        const s    = stats.get(addr);

        let pages = 0;
        let url   = `${proxy}/evm/activity/${addr}`
                  + `?chain_ids=${chainId}&type=send,receive,mint,burn&limit=1000`;

        while(url && pages < MAX_PAGES_PER_HOLDER){
          const r = await fetch(url); if(!r.ok){console.error(await r.text());break;}
          const { activity, next_offset } = await r.json();
          pages++;

          for(const ev of activity){
            const ts = new Date(ev.block_time).getTime();
            if(ts < fromMs) { url = null; break; }

            if(ev.asset_type==="erc20" && ev.token_address.toLowerCase()===token){
              const val = BigInt(ev.value);
              if(ev.type==="send" || ev.type==="burn"){
                s.outC++; s.outAmt += val;
              }
              if(ev.type==="receive" || ev.type==="mint"){
                s.inC++;  s.inAmt  += val;
              }
            }
          }
          if(!next_offset) break;
          url = `${proxy}/evm/activity/${addr}`
              + `?chain_ids=${chainId}&type=send,receive,mint,burn&limit=1000`
              + `&offset=${encodeURIComponent(next_offset)}`;
        }
        out.textContent = `⏳ processed ${TOP_HOLDERS - queue.length}/${TOP_HOLDERS}`;
      }
    }
    await Promise.all(Array.from({length:WORKERS}, worker));

    /* render (skip only if both counts are zero) */
const rows = Array.from(stats.entries())
  .filter(([, s]) => !(s.inC === 0 && s.outC === 0))   // ← updated
  .sort(([,a],[,b]) => a.balance === b.balance ? 0
                                               : a.balance > b.balance ? -1 : 1);


    rows.forEach(([addr,s])=>{
      const tr = tbody.insertRow();
      const link = document.createElement("a");
      link.href = scanBase + addr;
      link.target = "_blank"; link.rel="noopener"; link.textContent = addr;

      tr.insertCell().appendChild(link);
      tr.insertCell().textContent = fmt(s.balance, decimals);
      tr.insertCell().textContent = s.inC;
      tr.insertCell().textContent = fmt(s.inAmt, decimals);
      tr.insertCell().textContent = s.outC;
      tr.insertCell().textContent = fmt(s.outAmt, decimals);
    });

    tbl.hidden = false;
    out.textContent = `✅ ${rows.length} holders scanned`;
  }catch(err){
    console.error(err);
    out.textContent = `❌ ${err}`;
  }
});

/* helpers */
function fmt(bigInt, dec){
  const s = bigInt.toString().padStart(dec+1,"0");
  const int  = s.slice(0,-dec).replace(/\B(?=(\d{3})+(?!\d))/g,",");
  const frac = s.slice(-dec, -dec+2).replace(/0+$/,"");
  return int + (frac ? "." + frac : "");
}
