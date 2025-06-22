const endpoint = "https://sim.example.workers.dev/v1"; // your Worker or the direct https://api.sim.dune.com

document.getElementById("queryForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const addr   = document.getElementById("contract").value.trim();
  const chain  = document.getElementById("chain").value;
  const symbol = document.getElementById("symbol").value.trim();

  // work out the date window
  const range  = new FormData(e.target).get("range");
  const now    = new Date();
  let from, to = now.toISOString();
  if (range === "custom") {
    from = new Date(document.getElementById("from").value).toISOString();
  } else {
    const days = parseInt(range);
    from = new Date(now - days * 864e5).toISOString();
  }

  // Example call: token holders for the contract
  const url = `${endpoint}/evm/token-holders/${addr}?chain=${chain}&from=${from}&to=${to}`;

  const res  = await fetch(url);               // if not proxied: add {headers:{'X-Sim-Api-Key': 'YOUR_KEY'}}
  const data = await res.json();

  document.getElementById("output").textContent =
    JSON.stringify(data, null, 2);
});
