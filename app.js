/* ========= app.js (BigInt-safe + faster) ========= */

const proxy  = "https://smart-money.pdotcapital.workers.dev/v1";
const CHAINS = { ethereum:1, polygon:137, base:8453, optimism:10, arbitrum:42161 };
const MAX_HOLDERS = 1000;          // early-exit cap for fast UX

const form  = document.getElementById("queryForm");
const tbl   = document.getElementById("balTable");
const tbody = tbl.querySelector("tbody");
const out   = document.getElementById("output");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  tbl.hidden = true; tbody.innerHTML = "";
  out.textContent = "⏳ fetching holders…";

  try {
    /* inputs */
    const token = document.getElementById("contract").value.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(token)) throw new Error("Invalid contract address.");
    const chainId = CHAINS[document.getElementById("chain").value];

    /* holders stream (early-exit at MAX_HOLDERS) */
    let url = `${proxy}/evm/token-holders/${chainId}/${token}?limit=100`;
    const holders = [];
    let decimals = 18;

    while (url && holders.length < MAX_HOLDERS) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();

      holders.push(...j.holders);
      if (j.holders[0]?.decimals) decimals = j.holders[0].decimals; // fallback

      url = j.next_offset
        ? `${proxy}/evm/token-holders/${chainId}/${token}?limit=100&offset=${encodeURIComponent(j.next_offset)}`
        : null;
    }

    /* decimals via token-info (overrides fallback if succeeds) */
    decimals = await getDecimalsSafe(token, chainId, decimals);

    /* BigInt-safe sort */
    holders.sort((a, b) => {
      const A = BigInt(a.balance);
      const B = BigInt(b.balance);
      return A === B ? 0 : A > B ? -1 : 1;
    });

    /* render table */
    holders.forEach(h => {
      const row = tbody.insertRow();
      row.insertCell().textContent = h.wallet_address.slice(0, 10) + "…";
      row.insertCell().textContent = fmt(BigInt(h.balance), decimals);
    });

    tbl.hidden = false;
    out.textContent = `✅ ${holders.length} holders (showing top ${MAX_HOLDERS})`;
  } catch (err) {
    console.error(err);
    out.textContent = `❌ ${err.message}`;
  }
});

/* ---------- helpers ---------- */

async function getDecimalsSafe(token, chainId, fallback) {
  try {
    const r = await fetch(`${proxy}/evm/token-info/${token}?chain_ids=${chainId}`);
    if (!r.ok) return fallback;
    const j = await r.json();
    return j.tokens?.[0]?.decimals ?? fallback;
  } catch {
    return fallback;
  }
}

function fmt(big, dec) {
  const s = big.toString().padStart(dec + 1, "0");
  const int  = s.slice(0, -dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = s.slice(-dec, -dec + 2).replace(/0+$/, "");
  return int + (frac ? "." + frac : "");
}
