/* ========= app.js (fast, single-request) ========= */

const proxy  = "https://smart-money.pdotcapital.workers.dev/v1";
const CHAINS = { ethereum:1, polygon:137, base:8453, optimism:10, arbitrum:42161 };
const LIMIT  = 1000;                       // pull top 1k in one call

const form  = document.getElementById("queryForm");
const tbl   = document.getElementById("balTable");
const tbody = tbl.querySelector("tbody");
const out   = document.getElementById("output");

form.addEventListener("submit", async e => {
  e.preventDefault();
  tbl.hidden = true; tbody.innerHTML = "";
  out.textContent = "⏳ fetching…";

  try {
    /* inputs */
    const token = document.getElementById("contract").value.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(token)) throw new Error("Invalid contract.");
    const chainId = CHAINS[document.getElementById("chain").value];

    /* holders + decimals in parallel */
    const holdersReq = fetch(`${proxy}/evm/token-holders/${chainId}/${token}?limit=${LIMIT}`)
                         .then(r => r.ok ? r.json() : r.text().then(t=>Promise.reject(t)));
    const decimalsReq = fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`)
                         .then(r => r.ok ? r.json() : null)
                         .catch(()=>null);

    const [holdersJson, tokenInfo] = await Promise.all([holdersReq, decimalsReq]);

    const decimals =
      tokenInfo?.tokens?.[0]?.decimals ??
      holdersJson.holders?.[0]?.decimals ?? 18;

    /* sort BigInt safely */
    const holders = holdersJson.holders
      .sort((a,b)=> {
        const A = BigInt(a.balance), B = BigInt(b.balance);
        return A === B ? 0 : A > B ? -1 : 1;
      });

    /* render */
    holders.forEach(h => {
      const row = tbody.insertRow();
      row.insertCell().textContent = h.wallet_address.slice(0,10) + "…";
      row.insertCell().textContent = fmt(BigInt(h.balance), decimals);
    });

    tbl.hidden = false;
    out.textContent = `✅ ${holders.length} holders (top ${LIMIT})`;
  } catch (err) {
    console.error(err);
    out.textContent = `❌ ${err}`;
  }
});

/* ---------- helpers ---------- */

function fmt(big, dec){
  const s = big.toString().padStart(dec+1,"0");
  const int  = s.slice(0,-dec).replace(/\B(?=(\d{3})+(?!\d))/g,",");
  const frac = s.slice(-dec, -dec+2).replace(/0+$/,"");
  return int + (frac ? "."+frac : "");
}
