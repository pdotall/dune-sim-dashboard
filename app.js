/* ========= app.js (pagination edition) ========= */

const proxyBase = "https://smart-money.pdotcapital.workers.dev/v1";
const CHAIN_IDS = { ethereum:1, polygon:137, base:8453, optimism:10, arbitrum:42161 };

const out   = document.getElementById("output");
const form  = document.getElementById("queryForm");
const tbl   = document.getElementById("txTable");
const tbody = tbl.querySelector("tbody");
const sizeBar = document.getElementById("pageSizeBar");
const pageSizeSel = document.getElementById("pageSize");
const pager = document.getElementById("pager");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const pageInfo= document.getElementById("pageInfo");

let txs = [];          // full filtered list
let page = 1;          // current page (1-based)
let pageSize = 25;     // rows per page

pageSizeSel.addEventListener("change", () => {
  pageSize = +pageSizeSel.value;
  page = 1;
  renderTable();
  updateNav();
});
prevBtn.addEventListener("click", () => { if (page>1){ page--; renderTable(); updateNav(); }});
nextBtn.addEventListener("click", () => { if (page<maxPage()){ page++; renderTable(); updateNav(); }});
window.addEventListener("keydown", e => {
  if (e.key === "ArrowLeft") prevBtn.click();
  if (e.key === "ArrowRight") nextBtn.click();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  tbl.hidden = pager.hidden = sizeBar.hidden = true;
  out.textContent = "⏳ Fetching…";

  try {
    /* ---------- collect inputs ---------- */
    const addrInput = document.getElementById("contract");
    if (!addrInput.checkValidity()) throw new Error("Enter a valid 0x address.");
    const addr = addrInput.value.trim().toLowerCase();
    const chain = document.getElementById("chain").value;
    const chainId = CHAIN_IDS[chain];

    /* ---------- date window ---------- */
    const range = new FormData(form).get("range");
    let fromMs = 0, toMs = Date.now();
    if (range === "0") {
      const from = document.getElementById("from").value;
      const to   = document.getElementById("to").value;
      if (!from || !to) throw new Error("Pick both custom dates.");
      fromMs = new Date(from).getTime();
      toMs   = new Date(to).getTime();
    } else {
      fromMs = Date.now() - (+range) * 864e5;
    }

    /* ---------- pull pages from Sim ---------- */
    let url = `${proxyBase}/evm/transactions/${addr}?chain_ids=${chainId}&limit=100`;
    const all = [];
    while (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} – ${(await res.text()).slice(0,120)}`);
      const j = await res.json();
      all.push(...j.transactions);
      const next = j.next_offset;
      if (!next) break;
      const oldest = j.transactions.at(-1);
      if (new Date(oldest.block_time).getTime() < fromMs) break;
      url = `${proxyBase}/evm/transactions/${addr}?chain_ids=${chainId}&limit=100&offset=${encodeURIComponent(next)}`;
    }

    txs = all.filter(t => {
      const ts = new Date(t.block_time).getTime();
      return ts >= fromMs && ts <= toMs;
    });
    if (!txs.length) throw new Error("No transactions in that window.");

    page = 1;               // reset
    renderTable();
    updateNav();
    tbl.hidden     = false;
    sizeBar.hidden = false;
    pager.hidden   = false;
    out.textContent = `✅ ${txs.length} tx loaded`;
  } catch (err) {
    console.error(err);
    out.textContent = `❌ ${err.message}`;
  }
});

/* ---------- helpers ---------- */
function maxPage(){ return Math.ceil(txs.length / pageSize); }

function renderTable(){
  tbody.innerHTML = "";
  const start = (page-1)*pageSize;
  const slice = txs.slice(start, start+pageSize);
  slice.forEach(t => {
    const row = tbody.insertRow();
    row.insertCell().textContent = t.block_time.replace("T"," ").replace("Z","");
    row.insertCell().textContent = `${t.from.slice(0,6)}… → ${t.to.slice(0,6)}…`;
    row.insertCell().textContent = BigInt(t.value).toString();
    row.insertCell().textContent = t.hash.slice(0,10) + "…";
  });
}

function updateNav(){
  pageInfo.textContent = `Page ${page}/${maxPage()}`;
  prevBtn.disabled = page === 1;
  nextBtn.disabled = page === maxPage();
}
