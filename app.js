/* =========  app.js  (sortable table + expandable ENS)  ========= */

const proxy = "https://smart-money.pdotcapital.workers.dev/v1";

/* ---------- chain meta ---------- */
const CHAINS = {
  ethereum : { id:1,     scan:"https://etherscan.io/address/" },
  polygon  : { id:137,   scan:"https://polygonscan.com/address/" },
  base     : { id:8453,  scan:"https://basescan.org/address/" },
  optimism : { id:10,    scan:"https://optimistic.etherscan.io/address/" },
  arbitrum : { id:42161, scan:"https://arbiscan.io/address/" }
};

/* ---------- knobs ---------- */
const TOP_CAP = { 7:250, 14:250, 30:250, all:250 };
const WORKERS = 5;

/* ---------- helpers ---------- */
const HEX40=/^0x[a-f0-9]{40}$/i;

function fmt(bi,dec){
  const s=bi.toString().padStart(dec+1,"0");
  const i=s.slice(0,-dec).replace(/\B(?=(\d{3})+(?!\d))/g,",");
  const f=s.slice(-dec,-dec+2).replace(/0+$/,"");
  return i+(f?"."+f:"");
}
function trustLogo(addr,chain){
  try{
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chain}/assets/${ethers.utils.getAddress(addr)}/logo.png`;
  }catch{return"";}
}
function logoHTML(primary,fallback,sym){
  if(!primary&&!fallback) return sym;
  const first=primary||fallback;
  const esc=fallback.replace(/"/g,"&quot;");
  const onErr=fallback
    ?`onerror="if(this.src!=='${esc}'){this.src='${esc}';}else{this.style.display='none';}"`
    :`onerror="this.style.display='none'"`;
  return `<img src="${first}" style="width:16px;height:16px;border-radius:50%;vertical-align:middle" ${onErr}> ${sym}`;
}

/* ---------- sorting helper ---------- */
function enableSorting(table){
  if(table.dataset.sortReady) return;
  table.dataset.sortReady="1";
  const numCols=[2,3,4,5,6], dir={}, num=t=>parseFloat(t.replace(/,/g,""))||0;
  table.tHead.addEventListener("click",e=>{
    const th=e.target.closest("th"); if(!th) return;
    const col=th.cellIndex; if(!numCols.includes(col)) return;
    dir[col]=!dir[col]; const asc=dir[col];
    const rows=[...table.tBodies[0].rows];
    rows.sort((r1,r2)=>{const a=num(r1.cells[col].textContent),b=num(r2.cells[col].textContent);return asc?a-b:b-a;});
    rows.forEach(r=>table.tBodies[0].appendChild(r));
  });
}

/* ---------- ENS mapping (load once) ---------- */
const ensMapPromise=(async()=>{
  try{
    const txt=await fetch("data/ens_map.csv").then(r=>r.text()),map=new Map();
    txt.split(/\r?\n/).slice(1).forEach(l=>{
      const[o,n=""]=l.split(/,(.+)/); if(o) map.set(o.trim().toLowerCase(),n.replace(/^\[|\]$/g,"").trim());
    });
    return map;
  }catch(e){console.error("ENS CSV",e);return new Map();}
})();

/* ---------- DOM refs ---------- */
const form=document.getElementById("queryForm"),
      addrInput=document.getElementById("contract"),
      tbl=document.getElementById("balTable"),
      tbody=tbl.querySelector("tbody"),
      out=document.getElementById("output"),
      preview=document.getElementById("tokenPreview"),
      tokenLogo=document.getElementById("tokenLogo"),
      tokenName=document.getElementById("tokenName");

/* ---------- live preview badge ---------- */
addrInput.addEventListener("blur",async()=>{
  const addr=addrInput.value.trim().toLowerCase();
  if(!HEX40.test(addr)) return preview.classList.add("hidden");
  const chainKey=document.getElementById("chain").value, id=CHAINS[chainKey].id;
  try{
    const info=(await fetch(`${proxy}/evm/token-info/${addr}?chain_ids=${id}`).then(r=>r.json())).tokens?.[0];
    if(!info) throw 0;
    const fallback=trustLogo(addr,chainKey);
    tokenLogo.src=info.logo_url||fallback;
    tokenLogo.style.display="";
    tokenLogo.onerror=()=>{tokenLogo.style.display="none";};
    tokenName.textContent=`${info.name} (${info.symbol})`;
    preview.classList.remove("hidden");
  }catch{preview.classList.add("hidden");}
});

/* ---------- main ---------- */
form.addEventListener("submit",async e=>{
  e.preventDefault();
  tbl.hidden=true; tbody.innerHTML=""; out.textContent="⏳ fetching…";
  try{
    const token=addrInput.value.trim().toLowerCase();
    if(!HEX40.test(token)) throw new Error("Invalid contract address");

    const chainKey=document.getElementById("chain").value,
          {id:chainId,scan:scanBase}=CHAINS[chainKey];

    const sel=new FormData(form).get("range"),
          fromMs=sel==="all"?0:Date.now()-(+sel)*864e5,
          CAP=TOP_CAP[sel];

    /* holders + meta */
    const [holdersJson, meta]=await Promise.all([
      fetch(`${proxy}/evm/token-holders/${chainId}/${token}?limit=${CAP}`).then(r=>r.json()),
      fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`).then(r=>r.json())
    ]);

    const decimals=meta.tokens?.[0]?.decimals??18,
          symbol  =meta.tokens?.[0]?.symbol  ??"",
          simLogo =meta.tokens?.[0]?.logo_url??"",
          fallbackLogo=trustLogo(token,chainKey);

    /* build stats map */
    const stats=new Map();
    holdersJson.holders.forEach(h=>stats.set(h.wallet_address.toLowerCase(),{
      bal:BigInt(h.balance),inC:0,outC:0,inAmt:0n,outAmt:0n}));

    /* fetch activity per holder (1 page) */
    const queue=[...stats.keys()];
    async function worker(){
      while(queue.length){
        const addr=queue.pop(),s=stats.get(addr);
        const url=`${proxy}/evm/activity/${addr}?chain_ids=${chainId}&type=send,receive,mint,burn&limit=250`;
        const r=await fetch(url); if(!r.ok){console.error(await r.text());continue;}
        const {activity}=await r.json();
        activity.forEach(ev=>{
          if(Date.parse(ev.block_time)<fromMs) return;
          if(ev.asset_type!=="erc20"||ev.token_address.toLowerCase()!==token) return;
          const v=BigInt(ev.value);
          if(["send","burn"].includes(ev.type)){s.outC++;s.outAmt+=v;}
          if(["receive","mint"].includes(ev.type)){s.inC++;s.inAmt+=v;}
        });
        out.textContent=`⏳ processed ${CAP-queue.length}/${CAP}`;
      }
    }
    await Promise.all(Array.from({length:WORKERS},worker));

    /* render rows */
    const ensMap=await ensMapPromise;
    const rows=[...stats.entries()]
      .filter(([,s])=>s.inC||s.outC)
      .sort(([,a],[,b])=>Number(b.bal-a.bal));

    rows.forEach(([addr,s])=>{
      const tr=tbody.insertRow();

      /* Owner */
      const a=document.createElement("a");
      a.href=scanBase+addr; a.textContent=addr; a.target="_blank"; a.rel="noopener";
      tr.insertCell().appendChild(a);

      /* ENS (12-char ellipsis, toggle) */
      const ensCell=tr.insertCell(); ensCell.className="ens";
      const ens=(ensMap.get(addr)||"").trim();
      if(ens.length>12){
        ensCell.innerHTML=
          `<span class="short">${ens.slice(0,12)}…</span>`+
          `<span class="full">${ens.replace(/\s+/g,"<br>")}</span>`;
        ensCell.querySelector(".short").addEventListener("click",()=>{
          ensCell.classList.toggle("expand");
          const open=ensCell.classList.contains("expand");
          ensCell.querySelector(".short").style.display=open?"none":"inline";
          ensCell.querySelector(".full").style.display=open?"inline":"none";
        });
      }else ensCell.textContent=ens;

      /* numbers + token */
      tr.insertCell().textContent=fmt(s.bal,decimals);
      tr.insertCell().textContent=s.inC;
      tr.insertCell().textContent=fmt(s.inAmt,decimals);
      tr.insertCell().textContent=s.outC;
      tr.insertCell().textContent=fmt(s.outAmt,decimals);
      tr.insertCell().innerHTML=logoHTML(simLogo,fallbackLogo,symbol);
    });

    enableSorting(tbl);
    tbl.hidden=false;
    out.textContent=`✅ ${rows.length} holders`;
  }catch(err){console.error(err);out.textContent="❌ "+err;}
});
