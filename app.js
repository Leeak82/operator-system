const $ = (q) => document.querySelector(q);
const state = { listings: JSON.parse(localStorage.getItem('haulnow_listings') || '[]') };

$('#year').textContent = new Date().getFullYear();

const themeToggle = $('#themeToggle');
if (localStorage.getItem('theme') === 'light') document.documentElement.classList.add('light');
themeToggle.onclick = () => {
  document.documentElement.classList.toggle('light');
  localStorage.setItem('theme', document.documentElement.classList.contains('light') ? 'light' : 'dark');
};

let map = L.map('map').setView([39.5, -98.35], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
let routeLine;

async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en-US' } });
  const data = await res.json();
  return data[0] ? [parseFloat(data[0].lat), parseFloat(data[0].lon)] : null;
}

$('#bookingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const pickup = fd.get('pickup');
  const dropoff = fd.get('dropoff');
  const withDriver = fd.get('withDriver') === 'on';

  const [a, b] = await Promise.all([geocode(pickup), geocode(dropoff)]);
  const estimate = $('#estimate');
  if (!a || !b) {
    estimate.textContent = 'Could not find one of the addresses. Try more detail.';
    estimate.classList.remove('hidden');
    return;
  }

  if (routeLine) map.removeLayer(routeLine);
  routeLine = L.polyline([a, b], { color: '#50e3c2', weight: 5 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });

  const km = map.distance(a, b) / 1000;
  const base = 45 + km * 1.9;
  const driverFee = withDriver ? 55 : 0;
  const demandMultiplier = (new Date(fd.get('when')).getHours() >= 17) ? 1.15 : 1;
  const total = Math.round((base + driverFee) * demandMultiplier);

  estimate.innerHTML = `Estimated price: <strong>$${total}</strong> · Distance: ${km.toFixed(1)} km · ${withDriver ? 'Includes driver' : 'Self-drive'}<br><small>Next step: connect Stripe checkout + provider bidding API.</small>`;
  estimate.classList.remove('hidden');
});

function renderListings() {
  const el = $('#listings');
  if (!state.listings.length) {
    el.innerHTML = '<p class="sub">No listings yet. Be the first owner in your city.</p>';
    return;
  }
  el.innerHTML = state.listings.map(x => `<article class="listing"><strong>${x.type}</strong> · ${x.city}<br>$${x.rate}/hr · ${x.driverAvailable ? 'Driver available' : 'No driver'} · Owner: ${x.owner}</article>`).join('');
}

$('#truckForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const listing = Object.fromEntries(fd.entries());
  listing.driverAvailable = fd.get('driverAvailable') === 'on';
  state.listings.unshift(listing);
  localStorage.setItem('haulnow_listings', JSON.stringify(state.listings.slice(0, 30)));
  e.target.reset();
  renderListings();
});

renderListings();
