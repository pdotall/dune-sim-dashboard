/* ========= app.js  (logo fallback + fast scan) ========= */

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

/* ---------------- helpers ---------------- */
function fmt(bi, dec){
  const s = bi.toString().padStart(dec+1,"0");
  const int  = s.slice(0,-dec).replace(/\B(?=(\d{3})+(?!\d))/g,",");
  const frac = s.slice(-dec, -dec+2).replace(/0+$/,"");
  return int + (frac ? "."+frac : "");
}

/* choose best logo url */
function bestLogo(tokenAddr, simUrl, chainKey){
  if (simUrl && simUrl.startsWith("https://")) return simUrl;
  if (chainKey === "ethereum")
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${tokenAddr}/logo.png`;
  return "";
}

/* ---------------- DOM refs ---------------- */
const form  = document.getElementById("queryForm");
const addrI = document.getElementById("contract");
const tbl   = document.getElementById("balTable");
const tbody = tbl.querySelector("tbody");
const out   = document.getElementById("output");
const preview   = document.getElementById("tokenPreview");
const tokenLogo = document.getElementById("tokenLogo");
const tokenName = document.getElementById("tokenName");

/* -------- live preview -------- */
addrI.addEventListener("blur", fetchPreview);
async function fetchPreview(){
  const addr = addrI.value.trim().toLowerCase();
  if(!/^0x[a-f0-9]{40}$/.test(addr)){ preview.classList.add("hidden"); return; }
  const chainKey = document.getElementById("chain").value;
  const chainId  = CHAINS[chainKey].id;
  try{
    const r = await fetch(`${proxy}/evm/token-info/${addr}?chain_ids=${chainId}`);
    const info = (await r.json()).tokens?.[0];
    if(!info){ preview.classList.add("hidden"); return; }
    const logo = bestLogo(addr, info.logo_url ?? "", chainKey);
    tokenLogo.src = logo;
    tokenLogo.style.display = logo ? "" : "none";
    tokenName.textContent = `${info.name} (${info.symbol})`;
    preview.classList.remove("hidden");
  }catch{ preview.classList.add("hidden"); }
}

/* ---------- main scan ---------- */
form.addEventListener("submit", async (e)=>{
  e.preventDefault();
  tbl.hidden = true;
  tbody.innerHTML="";
  out.textContent="⏳ fetching holders…";

  try{
    const token = addrI.value.trim().toLowerCase();
    if(!/^0x[a-f0-9]{40}$/.test(token)) throw new Error("Invalid contract.");
    const chainKey = document.getElementById("chain").value;
    const { id:chainId, scan:scanBase } = CHAINS[chainKey];

    const sel   = new FormData(form).get("range");
    const now   = Date.now();
    const fromMs = sel==="all" ? 0 : now - (+sel)*864e5;
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
    const logoURL  = bestLogo(token, tokenInfo?.tokens?.[0]?.logo_url ?? "", chainKey);

    /* stats map */
    const stats = new Map();
    holdersJson.
