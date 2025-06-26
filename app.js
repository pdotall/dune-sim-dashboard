/* ========= app.js  (adds logo+symbol preview & column) ========= */

const proxy = "https://smart-money.pdotcapital.workers.dev/v1";
const CHAINS = {
  ethereum : { id: 1,     scan: "https://etherscan.io/address/" },
  polygon  : { id: 137,   scan: "https://polygonscan.com/address/" },
  base     : { id: 8453,  scan: "https://basescan.org/address/" },
  optimism : { id: 10,    scan: "https://optimistic.etherscan.io/address/" },
  arbitrum : { id: 42161, scan: "https://arbiscan.io/address/" }
};

/* speed knobs */
const TOP_CAP   = { all:1000, 30:1000, 14:750, 7:500 };
const WORKERS   = 5;
const MAX_PAGES = 5;

/* DOM refs */
const form  = document.getElementById("queryForm");
const addrI = document.getElementById("contract");
const tbl   = document.getElementById("balTable");
const tbody = tbl.querySelector("tbody");
const out   = document.getElementById("output");
const preview   = document.getElementById("tokenPreview");
const tokenLogo = document.getElementById("tokenLogo");
const tokenName = document.getElementById("tokenName");

/* --- live preview on blur --- */
addrI.addEventListener("blur", fetchPreview);
async function fetchPreview(){
  const addr = addrI.value.trim().toLowerCase();
  if(!/^0x[a-f0-9]{40}$/.test(addr)){ preview.classList.add("hidden"); return; }
  const chainId = CHAINS[document.getElementById("chain").value].id;
  try{
    const r = await fetch(`${proxy}/evm/token-info/${addr}?chain_ids=${chainId}`);
    if(!r.ok) throw new Error();
    const info = (await r.json()).tokens?.[0];
    if(!info){ preview.classList.add("hidden"); return; }
    tokenLogo.src = info.logo_url || "";
    tokenLogo.alt = info.symbol;
    tokenName.textContent = `${info.name} (${info.symbol})`;
    preview.classList.remove("hidden");
  }catch{ preview.classList.add("hidden"); }
}

/* ---------- main ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  tbl.hidden = true;
  tbody.innerHTML = "";
  out.textContent = "⏳ fetching holders…";

  try {
    /* inputs */
    const token = addrI.value.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(token)) throw new Error("Invalid contract.");
    const chainKey = document.getElementById("chain").value;
    const { id: chainId, scan: scanBase } = CHAINS[chainKey];

    /* window */
    const sel   = new FormData(form).get("range");        // all | 7 | 14 | 30
    const now   = Date.now();
    const fromMs = sel === "all" ? 0 : now - (+sel) * 864e5;
    const TOP_HOLDERS = TOP_CAP[sel];

    /* holders + token info */
    const holdersURL = `${proxy}/evm/token-holders/${chainId}/${token}?limit=${TOP_HOLDERS}`;
    const [holdersJson, tokenInfo] = await Promise.all([
      fetch(holdersURL).then(r=>r.ok?r.json():r.text().then(Promise.reject)),
      fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`)
        .then(r=>r.ok?r.json():null).catch(()=>null)
    ]);
    const decimals = tokenInfo?.tokens?.[0]?.decimals ??
                     holdersJson.holders?.[0]?.decimals ?? 18;
    const symbol   = tokenInfo?.tokens?.[0]?.symbol ?? "";
    const logoURL  = tokenInfo?.tokens?.[0]?.logo_url ?? "";

    /* stats map */
    const stats = new Map();
    holdersJson.holders.forEach(h=>{
      stats.set(h.wallet_address.toLowerCase(),{
        balance:BigInt(h.balance),
        inC:0,outC:0,inAmt:0n,outAmt:0n
      });
    });

    /* queue workers */
    const queue = [...stats.keys()];
    async function worker(){
      while(queue.length){
        const addr = queue.pop();
        const s    = stats.get(addr);

        let pages=0, limit=250;
        let url = `${proxy}/evm/activity/${addr}`
                + `?chain_ids=${chainId}&type=send,receive,mint,burn&limit=${limit}`;
        while(url && pages<MAX_PAGES){
          const r = await fetch(url); if(!r.ok){console.error(await r.text());break;}
          const {activity,next_offset}=await r.json();
          pages++;

          for(const ev of activity){
            const ts = new Date(ev.block_time).getTime();
            if(ts<fromMs){url=null;break;}
            if(ev.asset_type==="erc20" && ev.token_address.toLowerCase()===token){
              const val=BigInt(ev.value);
              if(["send","burn"].includes(ev.type)){ s.outC++; s.outAmt+=val; }
              if(["receive","mint"].includes(ev.type)){ s.inC++; s.inAmt+=val; }
            }
          }
          if(!next_offset) break;
          limit=1000;
          url = `${proxy}/evm/activity/${addr}`
              + `?chain_ids=${chainId}&type=send,receive,mint,burn&limit=${limit}`
              + `&offset=${encodeURIComponent(next_offset)}`;
        }
        out.textContent=`⏳ processed ${TOP_HOLDERS-queue.length}/${TOP_HOLDERS}`;
      }
    }
    await Promise.all(Array.from({length:WORKERS},worker));

    /* render rows */
    const rows = Array.from(stats.entries())
      .filter(([,s])=>!(s.inC===0&&s.outC===0))
      .sort(([,a],[,b])=>a.balance===b.balance?0:a.balance>b.balance?-1:1);

    rows.forEach(([addr,s])=>{
      const tr = tbody.insertRow();
      const a  = document.createElement("a");
      a.href = scanBase+addr; a.target="_blank"; a.rel="noopener"; a.textContent=addr;

      const logo = `<img src="${logoURL}" alt="" style="width:16px;height:16px;border-radius:50%;vertical-align:middle">`;

      tr.insertCell().appendChild(a);
      tr.insertCell().textContent = fmt(s.balance,decimals);
      tr.insertCell().textContent = s.inC;
      tr.insertCell().textContent = fmt(s.inAmt,decimals);
      tr.insertCell().textContent = s.outC;
      tr.insertCell().textContent = fmt(s.outAmt,decimals);
      tr.insertCell().innerHTML   = logo + ` ${symbol}`;
    });

    tbl.hidden = false;
    out.textContent = `✅ ${rows.length} holders scanned`;
  }catch(err){
    console.error(err);
    out.textContent = `❌ ${err}`;
  }
});

/* helpers */
function fmt(bi,dec){
  const s = bi.toString().padStart(dec+1,"0");
  const int=s.slice(0,-dec).replace(/\B(?=(\d{3})+(?!\d))/g,",");
  const frac=s.slice(-dec,-dec+2).replace(/0+$/,"");
  return int + (frac ? "."+frac : "");
}
