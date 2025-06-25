/* ========= app.js (balance-only) ========= */

const proxy  = "https://smart-money.pdotcapital.workers.dev/v1";
const CHAINS = { ethereum:1, polygon:137, base:8453, optimism:10, arbitrum:42161 };

const form = document.getElementById("queryForm");
const tbl  = document.getElementById("balTable");
const tbody= tbl.querySelector("tbody");
const out  = document.getElementById("output");

form.addEventListener("submit", async e=>{
  e.preventDefault();
  tbl.hidden = true; tbody.innerHTML = "";
  out.textContent = "⏳ fetching holders…";

  try{
    /* inputs */
    const token = document.getElementById("contract").value.trim().toLowerCase();
    if(!/^0x[a-f0-9]{40}$/.test(token)) throw new Error("Invalid contract.");
    const chainId = CHAINS[document.getElementById("chain").value];

    /* decimals (for pretty formatting) */
    const dec = await getDecimals(token, chainId);

    /* holders stream */
    let url = `${proxy}/evm/token-holders/${chainId}/${token}?limit=100`;
    const holders = [];
    while(url){
      const r = await fetch(url); if(!r.ok) throw new Error(await r.text());
      const j = await r.json();
      holders.push(...j.holders);
      url = j.next_offset
        ? `${proxy}/evm/token-holders/${chainId}/${token}?limit=100&offset=${encodeURIComponent(j.next_offset)}`
        : null;
    }

    /* render */
    holders.sort((a,b)=> BigInt(b.balance) - BigInt(a.balance));
    holders.forEach(h=>{
      const row = tbody.insertRow();
      row.insertCell().textContent = h.wallet_address.slice(0,10)+"…";
      row.insertCell().textContent = fmt(BigInt(h.balance), dec);
    });
    tbl.hidden = false;
    out.textContent = `✅ ${holders.length} holders`;
  }catch(err){
    console.error(err);
    out.textContent = `❌ ${err.message}`;
  }
});

/* ---------- helpers ---------- */

async function getDecimals(token, chainId){
  const r = await fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`);
  if(!r.ok) return 18;
  const j = await r.json();
  return j.tokens?.[0]?.decimals ?? 18;
}

function fmt(big, dec){
  const s = big.toString().padStart(dec+1,"0");
  const int = s.slice(0,-dec).replace(/\B(?=(\d{3})+(?!\d))/g,",");
  const frac= s.slice(-dec, -dec+2).replace(/0+$/,"");
  return int + (frac? "."+frac :"");
}
