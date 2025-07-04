/* =========  app.js  (sortable + ENS expand, full 8 columns) ========= */

const proxy = "https://smart-money.pdotcapital.workers.dev/v1";

/* ---------- chain meta ---------- */
const CHAINS = {
  ethereum : { id:1, scan:"https://etherscan.io/address/" },
  polygon  : { id:137, scan:"https://polygonscan.com/address/" },
  base     : { id:8453, scan:"https://basescan.org/address/" },
  optimism : { id:10,  scan:"https://optimistic.etherscan.io/address/" },
  arbitrum : { id:42161,scan:"https://arbiscan.io/address/" }
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
  const first=primary||fallback,
        esc=fallback.replace(/"/g,"&quot;"),
        onErr=fallback?`onerror="if(this.src!=='${esc}'){this.src='${esc}';}else{this.style.display='none';}"`:`onerror="this.style.display='none'"`;
  return `<img src="${first}" style="width:16px;height:16px;border-radius:50%;vertical-align:middle" ${onErr}> ${sym}`;
}

/* ---------- sorting helper ---------- */
function enableSorting(tbl){
  if(tbl.dataset.sortReady) return;
  tbl.dataset.sortReady="1";
  const cols=[2,3,4,5,6], dir={}, num=t=>parseFloat(t.replace(/,/g,""))||0;
  tbl.tHead.addEventListener("click",e=>{
    const th=e.target.closest("th"); if(!th) return;
    const c=th.cellIndex; if(!cols.includes(c)) return;
    dir[c]=!dir[c]; const asc=dir[c];
    const rows=[...tbl.tBodies[0].rows];
    rows.sort((r1,r2)=>{const a=num(r1.cells[c].textContent),b=num(r2.cells[c].textContent);return asc?a-b:b-a;});
    rows.forEach(r=>tbl.tBodies[0].appendChild(r));
  });
}

/* ---------- ENS map (load once) ---------- */
const ensMapPromise=(async()=>{
  try{
    const txt=await fetch("data/ens_map.csv").then(r=>r.text()), m=new Map();
    txt.split(/\r?\n/).slice(1).forEach(l=>{
      const[o,n=""]=l.split(/,(.+)/); if(o) m.set(o.trim().toLowerCase(),n.replace(/^\[|\]$/g,"").trim());
    });
    return m;
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
    tokenLogo.src=info.logo_url||fallback; tokenLogo.style.display="";
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

    /* parallel fetch */
    const [holdersJson,meta]=await Promise.all([
      fetch(`${proxy}/evm/token-holders/${chainId}/${token}?limit=${CAP}`).then(r=>r.json()),
      fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`).then(r=>r.json())
    ]);

    const decimals=meta.tokens?.[0]?.decimals??18,
          symbol  =meta.tokens?.[0]?.symbol  ??"",
          simLogo =meta.tokens?.[0]?.logo_url??"",
          fallbackLogo=trustLogo(token,chainKey);

    /* init stats */
    const stats=new Map();
    holdersJson.holders.forEach(h=>stats.set(h.wallet_address.toLowerCase(),{
      bal:BigInt(h.balance),inC:0,outC:0,inAmt:0n,outAmt:0n
    }));

    /* workers → activity */
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
      .sort(([,a],[,b])=>Number(b.bal-a.bal));   // show all CAP rows

    rows.forEach(([addr,s])=>{
      const tr=tbody.insertRow();

      /* owner */
      const a=document.createElement("a");
      a.href=scanBase+addr; a.textContent=addr; a.target="_blank"; a.rel="noopener";
      tr.insertCell().appendChild(a);

      /* ENS expandable */
      const ensCell=tr.insertCell(); ensCell.className="ens";
      const ens=(ensMap.get(addr)||"").trim();
      if(ens.length>18){
        ensCell.innerHTML=
          `<span class="short">${ens.slice(0,18)}…</span>`+
          `<span class="full">${ens.replace(/\s+/g,"<br>")}</span>`;
        ensCell.querySelector(".short").addEventListener("click",()=>{
          ensCell.classList.toggle("expand");
          const o=ensCell.classList.contains("expand");
          ensCell.querySelector(".short").style.display=o?"none":"inline";
          ensCell.querySelector(".full").style.display=o?"inline":"none";
        });
      }else ensCell.textContent=ens;

      /* numeric + token */
      tr.insertCell().textContent=fmt(s.bal,decimals);      // Balance
      tr.insertCell().textContent=s.inC;                    // Tx In
      tr.insertCell().textContent=fmt(s.inAmt,decimals);    // Amount In
      tr.insertCell().textContent=s.outC;                   // Tx Out (count)
      tr.insertCell().textContent=fmt(s.outAmt,decimals);   // Amount Out
      tr.insertCell().innerHTML=logoHTML(simLogo,fallbackLogo,symbol);
    });

    enableSorting(tbl);
    tbl.hidden=false;
    out.textContent=`✅ ${rows.length} holders`;
  }catch(err){console.error(err); out.textContent="❌ "+err;}
});
