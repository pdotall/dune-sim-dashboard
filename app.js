/* ---- app.js  (fast aggregate version) ---- */

const proxy  = "https://smart-money.pdotcapital.workers.dev/v1";
const CHAINS = { ethereum:1, polygon:137, base:8453, optimism:10, arbitrum:42161 };

const out  = document.getElementById("output");
const tbody= document.querySelector("#txTable tbody");
const tbl  = document.getElementById("txTable");

document.getElementById("queryForm").addEventListener("submit", run);

async function run(e){
  e.preventDefault();
  tbl.hidden = true; tbody.innerHTML = "";
  out.textContent = "⏳ fetching holders…";

  try {
    /* inputs */
    const token = contract().toLowerCase();
    const chainId = CHAINS[document.getElementById("chain").value];
    const {fromMs, toMs} = windowMs();

    /* 1. current balances */
    const holders = await fetchHolders(token, chainId);

    /* 2. aggregate transfers once, not per wallet */
    out.textContent = "⏳ scanning transfers…";
    const stats = await aggregateTransfers(token, chainId, fromMs, toMs);

    /* 3. merge + render */
    const dec = await lookupDecimals(token, chainId);
    const rows = holders.map(h=>{
      const s = stats.get(h.wallet_address.toLowerCase()) || {};
      return {
        owner:   h.wallet_address,
        balance: BigInt(h.balance),
        inC:  s.inC  || 0,
        inA:  s.inA  || 0n,
        outC: s.outC || 0,
        outA: s.outA || 0n
      };
    }).sort((a,b)=>Number(b.balance - a.balance));

    rows.forEach(r=>{
      const tr = tbody.insertRow();
      tr.insertCell().textContent = r.owner.slice(0,10)+"…";
      tr.insertCell().textContent = fmt(r.balance,dec);
      tr.insertCell().textContent = r.inC;
      tr.insertCell().textContent = fmt(r.inA,dec);
      tr.insertCell().textContent = r.outC;
      tr.insertCell().textContent = fmt(r.outA,dec);
    });
    tbl.hidden = false;
    out.textContent = `✅ ${rows.length} holders processed`;
  } catch(err){
    console.error(err); out.textContent = `❌ ${err.message}`;
  }
}

/* -------- helpers -------- */

function contract(){ return document.getElementById("contract").value.trim(); }

function windowMs(){
  const range = new FormData(document.getElementById("queryForm")).get("range");
  const now = Date.now();
  if(range==="0"){
    const f = new Date(document.getElementById("from").value).getTime();
    const t = new Date(document.getElementById("to").value).getTime();
    if(!f||!t) throw new Error("pick custom dates"); return {fromMs:f,toMs:t};
  }
  return {fromMs: now - (+range)*864e5, toMs: now};
}

async function fetchHolders(token, chainId){
  let url = `${proxy}/evm/token-holders/${chainId}/${token}?limit=100`;
  const all=[];
  while(url){
    const r=await fetch(url); if(!r.ok) throw new Error(await r.text());
    const j=await r.json();   all.push(...j.holders);
    url = j.next_offset ? `${proxy}/evm/token-holders/${chainId}/${token}?limit=100&offset=${encodeURIComponent(j.next_offset)}` : null;
  }
  return all;
}

async function aggregateTransfers(token, chainId, fromMs, toMs){
  const m = new Map();
  let url = `${proxy}/evm/activity/${token}?chain_ids=${chainId}&limit=1000`;
  while(url){
    const r=await fetch(url); if(!r.ok) throw new Error(await r.text());
    const j=await r.json();
    for(const a of j.activity){
      if(a.asset_type!=="erc20") continue;
      const ts = new Date(a.block_time).getTime();
      if(ts<fromMs) return m;         // reached end of window
      if(ts>toMs)  continue;
      const from = a.from.toLowerCase();
      const to   = a.to.toLowerCase();
      const val  = BigInt(a.value);

      if(from!==token){              // outgoing from holder
        const s = m.get(from) || (m.set(from,{inC:0,outC:0,inA:0n,outA:0n}), m.get(from));
        s.outC++; s.outA += val;
      }
      if(to!==token){                // incoming to holder
        const s = m.get(to) || (m.set(to,{inC:0,outC:0,inA:0n,outA:0n}), m.get(to));
        s.inC++; s.inA += val;
      }
    }
    url = j.next_offset ? `${proxy}/evm/activity/${token}?chain_ids=${chainId}&limit=1000&offset=${encodeURIComponent(j.next_offset)}` : null;
  }
  return m;
}

async function lookupDecimals(token, chainId){
  const r=await fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`);
  if(!r.ok) return 18; const j=await r.json();
  return j.tokens?.[0]?.decimals ?? 18;
}

function fmt(bi,dec){
  const s=bi.toString().padStart(dec+1,"0");
  const int=s.slice(0,-dec).replace(/\B(?=(\d{3})+(?!\d))/g,",");
  const frac=s.slice(-dec,-dec+2).replace(/0+$/,"");
  return int+(frac? "."+frac:"");
}
