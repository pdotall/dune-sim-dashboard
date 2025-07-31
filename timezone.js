const form = document.getElementById('tzForm');
const output = document.getElementById('output');
const spinner = document.getElementById('spinner');
const chartCanvas = document.getElementById('tzChart');
let chart;

const TZ_OFFSETS = Array.from({ length: 24 }, (_, i) => i - 12); // UTC-12 to UTC+11

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const address = document.getElementById('address').value.toLowerCase();
  output.textContent = '';
  spinner.classList.remove('hidden');

  try {
    const scores = await analyzeAddress(address);
    const best = scores.reduce((a, b) => (a.score > b.score ? a : b));

    output.textContent = `Most likely timezone: UTC${best.offset >= 0 ? '+' : ''}${best.offset}`;

    drawChart(scores);
  } catch (err) {
    output.textContent = 'error: ' + err.message;
  } finally {
    spinner.classList.add('hidden');
  }
});

async function analyzeAddress(address) {
  const res = await fetch(`https://api.dune.com/sim/v1/query/1651485?parameters=${encodeURIComponent(JSON.stringify({ address }))}`);
  const json = await res.json();

  if (!json.result || !json.result.rows) throw new Error('No data');

  const txData = json.result.rows;

  return TZ_OFFSETS.map(offset => {
    const hours = Array(24).fill(0);

    for (const row of txData) {
      const raw = new Date(row.block_time);
      const utcHour = raw.getUTCHours();
      const shifted = (utcHour + offset + 24) % 24;
      hours[shifted]++;
    }

    // score: center around hour 12 ± a few hours
    const score = gaussianScore(hours);
    return { offset, score, hours };
  });
}

function gaussianScore(hours) {
  let score = 0;
  for (let i = 0; i < 24; i++) {
    const center = 12;
    const std = 4;
    const weight = Math.exp(-((i - center) ** 2) / (2 * std ** 2));
    score += weight * hours[i];
  }
  return score;
}

function drawChart(scores) {
  const best = scores.reduce((a, b) => (a.score > b.score ? a : b));
  const labels = Array.from({ length: 24 }, (_, i) => i);
  const data = best.hours;

  if (chart) chart.destroy();
  chart = new Chart(chartCanvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: `Transactions by Hour (UTC${best.offset >= 0 ? '+' : ''}${best.offset})`,
        data,
        backgroundColor: '#5865f2',
      }],
    },
    options: {
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
}
