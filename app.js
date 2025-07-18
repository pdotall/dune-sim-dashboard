const proxy = "https://smart-money.pdotcapital.workers.dev/v1";

/* ---------- chain meta ---------- */
const CHAINS = {
  ethereum:{id:1,scan:"https://etherscan.io/address/"},
  polygon :{id:137,scan:"https://polygonscan.com/address/"},
  base    :{id:8453,scan:"https://basescan.org/address/"},
  optimism:{id:10,scan:"https://optimistic.etherscan.io/address/"},
  arbitrum:{id:42161,scan:"https://arbiscan.io/address/"}
};

const WORKERS = 5;
const HEX40 = /^0x[a-f0-9]{40}$/i;

/* ---------- helpers ---------- */
const fmt = (bi, dec)=>{
  const s = bi.toString().padStart(dec+1,"0");
  const i = s.slice(0,-dec).replace(/\B(?=(\d{3})+(?!\d))/g,",");
  const f = s.slice(-dec,-dec+2).replace(/0+$/,"");
  return i + (f? "."+f : "");
};
const trustLogo = (addr,chain)=>{
  try{
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chain}/assets/${ethers.utils.getAddress(addr)}/logo.png`;
  }catch{return "";}
};
function logoHTML(p,f,sym){
  if(!p && !f) return sym;
  const esc = f.replace(/"/g,"&quot;");
  return `<img src="${p||f}" style="width:16px;height:16px;border-radius:50%;vertical-align:middle" ${
    f ? `onerror="if(this.src!=='${esc}'){this.src='${esc}';}else{this.style.display='none';}"`
      : `onerror="this.style.display='none'"`
  }> ${sym}`;
}

/* ---------- sorting ---------- */
function enableSorting(tbl){
  if(tbl.dataset.sortReady) return;
  tbl.dataset.sortReady="1";
  const cols=[2,3,4,5,6], dir={}, num=t=>parseFloat(t.replace(/,/g,""))||0;
  tbl.tHead.addEventListener("click",e=>{
    const th=e.target.closest("th"); if(!th) return;
    const c=th.cellIndex; if(!cols.includes(c)) return;
    dir[c]=!dir[c]; const asc=dir[c];
    [...tbl.tBodies[0].rows]
      .sort((a,b)=>{const x=num(a.cells[c].textContent),y=num(b.cells[c].textContent);return asc?x-y:y-x;})
      .forEach(r=>tbl.tBodies[0].appendChild(r));
  });
}

/* ---------- ENS map ---------- */
const ensMapPromise = (async()=>{
  try{
    const txt = await fetch("data/ens_map.csv").then(r=>r.text()), m=new Map();
    txt.split(/\r?\n/).slice(1).forEach(l=>{
      const[o,n=""]=l.split(/,(.+)/);
      if(o) m.set(o.trim().toLowerCase(),n.replace(/^\[|\]$/g,"").trim());
    });
    return m;
  }catch(e){console.error("ENS CSV",e);return new Map();}
})();

/* ---------- DOM refs ---------- */
const $ = s=>document.querySelector(s);
const form=$("#queryForm"),
      tbl=$("#balTable"), tbody=tbl.querySelector("tbody"),
      status=$("#output"),
      spinner=$("#spinner"),
      preview=$("#tokenPreview"), tokenLogo=$("#tokenLogo"), tokenName=$("#tokenName"),
      whaleToggle=$("#whaleToggle"), toggleText=$("#toggleText");

whaleToggle.addEventListener("change",()=>toggleText.textContent = whaleToggle.checked ? "Active whales" : "All whales");

/* ---------- spinner helpers ---------- */
let track=false;
function showSpinner(){track=true; spinner.classList.remove("hidden");}
function hideSpinner(){track=false; spinner.classList.add("hidden");}
document.addEventListener("mousemove",e=>{
  if(track){
    spinner.style.left=e.clientX+"px";
    spinner.style.top =e.clientY+"px";
  }
});

/* ---------- live badge ---------- */
$("#contract").addEventListener("blur",async e=>{
  const addr=e.target.value.trim().toLowerCase();
  if(!HEX40.test(addr)){preview.classList.add("hidden");return;}
  const chainKey=$("#chain").value, id=CHAINS[chainKey].id;
  try{
    const info=(await fetch(`${proxy}/evm/token-info/${addr}?chain_ids=${id}`).then(r=>r.json())).tokens?.[0];
    if(!info) throw 0;
    tokenLogo.src=info.logo_url||trustLogo(addr,chainKey);
    tokenLogo.style.display="";
    tokenLogo.onerror=()=>tokenLogo.style.display="none";
    tokenName.textContent=`${info.name} (${info.symbol})`;
    preview.classList.remove("hidden");
  }catch{preview.classList.add("hidden");}
});

/* ---------- main submit ------------------------------------------ */
form.addEventListener("submit",async e=>{
  e.preventDefault();
  tbl.hidden=true; tbody.innerHTML="";
  status.textContent="⏳ fetching…";
  showSpinner();

  try{
    const token=$("#contract").value.trim().toLowerCase();
    if(!HEX40.test(token)) throw new Error("Invalid contract address");

    const chainKey=$("#chain").value,
          {id:chainId,scan:scanBase}=CHAINS[chainKey];

    const fd=new FormData(form);
    const days=fd.get("range"), cap=parseInt(fd.get("cap")||250,10);
    const activeOnly=whaleToggle.checked;

    const now=new Date(), fromMs=(()=>{
      if(days==="all") return 0;
      const utcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      return utcDay - (+days)*864e5;
    })();

    /* holders + meta */
    const [holdersJson,meta]=await Promise.all([
      fetch(`${proxy}/evm/token-holders/${chainId}/${token}?limit=${cap}`).then(r=>r.json()),
      fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`).then(r=>r.json())
    ]);

    const decimals=meta.tokens?.[0]?.decimals??18,
          symbol  =meta.tokens?.[0]?.symbol  ??"",
          simLogo =meta.tokens?.[0]?.logo_url??"",
          fallbackLogo=trustLogo(token,chainKey);

    const stats=new Map();
    holdersJson.holders.forEach(h=>stats.set(
      h.wallet_address.toLowerCase(),{bal:BigInt(h.balance),inC:0,outC:0,inAmt:0n,outAmt:0n}));

    const queue=[...stats.keys()].sort();
    await Promise.all(Array.from({length:WORKERS},async()=>{
      while(queue.length){
        const addr=queue.pop(),s=stats.get(addr);
        const url = `${proxy}/evm/activity/${addr}?chain_ids=${chainId}&type=send,receive,mint,burn&limit=250&sort_by=block_time&sort_order=asc`;
        const r=await fetch(url); if(!r.ok){console.error(await r.text()); continue;}
        const {activity}=await r.json();
        activity.forEach(ev=>{
          if(Date.parse(ev.block_time)<fromMs) return;
          if(ev.asset_type!=="erc20"||ev.token_address.toLowerCase()!==token) return;
          const v=BigInt(ev.value);
          if(["send","burn"].includes(ev.type)){s.outC++;s.outAmt+=v;}
          if(["receive","mint"].includes(ev.type)){s.inC++;s.inAmt+=v;}
        });
        status.textContent=`⏳ processed ${cap-queue.length}/${cap}`;
      }
    }));

    const ensMap=await ensMapPromise;
    const rows=[...stats.entries()]
      .filter(([,s])=>activeOnly ? (s.inC>0||s.outC>0) : true)
      .sort(([,a],[,b])=>Number(b.bal-a.bal));

    rows.forEach(([addr,s])=>{
      const tr=tbody.insertRow();

      const link=document.createElement("a");
      link.href=scanBase+addr; link.textContent=addr;
      link.target="_blank"; link.rel="noopener";
      tr.insertCell().appendChild(link);

      const ensCell=tr.insertCell(); ensCell.className="ens";
      const ens=(ensMap.get(addr)||"").trim();
      if(ens.length>18){
        ensCell.innerHTML=`<span class="short">${ens.slice(0,18)}…</span><span class="full">${ens.replace(/\s+/g,"<br>")}</span>`;
        ensCell.querySelector(".short").addEventListener("click",()=>{
          ensCell.classList.toggle("expand");
          const o=ensCell.classList.contains("expand");
          ensCell.querySelector(".short").style.display=o?"none":"inline";
          ensCell.querySelector(".full").style.display=o?"inline":"none";
        });
      }else ensCell.textContent=ens;

      tr.insertCell().textContent=fmt(s.bal,decimals);
      tr.insertCell().textContent=s.inC;
      tr.insertCell().textContent=fmt(s.inAmt,decimals);
      tr.insertCell().textContent=s.outC;
      tr.insertCell().textContent=fmt(s.outAmt,decimals);
      tr.insertCell().innerHTML=logoHTML(simLogo,fallbackLogo,symbol);
    });

    enableSorting(tbl);
    tbl.hidden=false;
    status.textContent=`🐳 ${rows.length} whales`;
    hideSpinner();
  }catch(err){
    console.error(err);
    status.textContent="❌ "+(err.message||err);
    hideSpinner();
  }
});
