const map = L.map('map').setView([25.1315, 55.4201], 16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
}).addTo(map);

const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
  draw: { rectangle: true, polygon: true, circle: false, marker: false },
  edit: { featureGroup: drawnItems },
});
map.addControl(drawControl);

// Save Drawn Geofence (POST to relative API)
map.on(L.Draw.Event.CREATED, async (event) => {
  const layer = event.layer;
  drawnItems.addLayer(layer);

  const geojson = layer.toGeoJSON();
  const payload = { name: `Geofence ${Date.now()}`, geojson };

  try {
    const response = await fetch('/api/geofence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (response.ok) alert('Geofence saved successfully!'); else alert('Failed to save geofence.');
  } catch (error) {
    console.error('Error saving geofence:', error);
  }
});

// Fetch and render saved geofences
async function fetchGeofences() {
  try {
    const res = await fetch('/api/geofence');
    const geofences = await res.json();
    geofences.forEach(g => drawnItems.addLayer(L.geoJSON(g.geojson)));
  } catch (err) { console.error('Error fetching geofences:', err); }
}
fetchGeofences();

// Socket.IO (relative)
const socket = io();

let markers = {};

function upsertDevice(id, lat, lng) {
  if (!markers[id]) {
    markers[id] = L.marker([lat, lng]).addTo(map);
    markers[id].bindPopup(`${id}`);
  } else {
    markers[id].setLatLng([lat, lng]);
    markers[id].getPopup().setContent(`${id}: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
  }
}

function updateTable(lat, lng) {
  const tableBody = document.querySelector('#gps-table tbody');
  const row = document.createElement('tr');
  row.innerHTML = `<td>${lat.toFixed(6)}</td><td>${lng.toFixed(6)}</td><td>${new Date().toLocaleString()}</td>`;
  tableBody.prepend(row);
}

function addAlert(text, type = 'warning') {
  const alerts = document.getElementById('alerts');
  const el = document.createElement('div');
  el.className = `alert alert-${type} py-1 mb-1`;
  el.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
  alerts.prepend(el);
}

function addOrUpdateDeviceList(id, info = {}) {
  const list = document.getElementById('device-list');
  let item = document.getElementById(`device-${id}`);
  if (!item) {
    item = document.createElement('button');
    item.id = `device-${id}`;
    item.className = 'list-group-item list-group-item-action';
    item.textContent = id;
    item.onclick = () => { document.getElementById('device-details').textContent = JSON.stringify(info); };
    list.prepend(item);
  } else {
    item.textContent = id;
  }
}

// Listen for location updates from server
socket.on('locationUpdate', (payload) => {
  // payload expected: { id, lat, lng, battery?, sos?, fall? }
  const id = payload.id || 'device-1';
  const { lat, lng } = payload;
  if (lat && lng) {
    upsertDevice(id, lat, lng);
    updateTable(lat, lng);
    addOrUpdateDeviceList(id, payload);
  }

  if (payload.sos) addAlert(`SOS from ${id}`, 'danger');
  if (payload.fall) addAlert(`Fall detected on ${id}`, 'warning');
  if (payload.battery !== undefined) document.getElementById('device-details').textContent = `Battery: ${payload.battery}%`;
  if (payload.geofenceInside === false) addAlert(`Device ${id} left geofence`, 'warning');
  if (payload.geofenceInside === true) addAlert(`Device ${id} inside geofence`, 'success');

  // Update device-basic with sensor info
  const basic = document.getElementById('device-basic');
  if (basic) {
    let s = `Battery: ${payload.battery ?? 'N/A'}%`;
    if (payload.distance !== undefined) s += ` | Dist: ${payload.distance}cm`;
    if (payload.puddle !== undefined) s += ` | Puddle: ${payload.puddle ? 'YES' : 'NO'}`;
    basic.textContent = s;
  }

  // If device is selected, also refresh history to show sensor timeline
  const selected = document.querySelector('#device-list .active');
  if (selected && selected.id === `device-${id}`) showHistoryForDevice(id);
});

// Fetch and show history when a device is clicked
async function showHistoryForDevice(deviceId) {
  try {
    const res = await fetch(`/api/history/${deviceId}?limit=200`);
    const rows = await res.json();
    const tableBody = document.querySelector('#gps-table tbody');
    tableBody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.lat.toFixed(6)}</td><td>${r.lng.toFixed(6)}</td><td>${new Date(r.createdAt).toLocaleString()}</td>`;
      tableBody.appendChild(tr);
    });
  } catch (e) { console.error('History fetch error', e); }
}

// Battery chart
let batteryChart = null;
function renderBatteryChart(rows, deviceId) {
  const ctx = document.getElementById('battery-chart').getContext('2d');
  const data = rows.slice().reverse(); // chronological
  const labels = data.map(r => new Date(r.createdAt).toLocaleTimeString());
  const values = data.map(r => (r.battery !== undefined ? r.battery : null));

  const chartData = {
    labels,
    datasets: [{ label: 'Battery %', data: values, borderColor: '#007bff', backgroundColor: 'rgba(0,123,255,0.1)', tension: 0.2, fill: true }]
  };

  if (batteryChart) {
    batteryChart.data = chartData;
    batteryChart.update();
    return;
  }

  batteryChart = new Chart(ctx, {
    type: 'line', data: chartData, options: { scales: { y: { beginAtZero: true, suggestedMax: 100 } } }
  });
}

// Route playback variables
let playbackInterval = null;
let playbackIndex = 0;
let playbackRows = [];
let playbackMarker = null;

function startPlayback() {
  const speed = parseInt(document.getElementById('playback-speed').value || '1000', 10);
  if (!playbackRows || playbackRows.length === 0) return;
  if (playbackInterval) clearInterval(playbackInterval);
  playbackInterval = setInterval(() => {
    const r = playbackRows[playbackIndex % playbackRows.length];
    if (!playbackMarker) playbackMarker = L.circleMarker([r.lat, r.lng], { radius: 8, color: 'red' }).addTo(map);
    playbackMarker.setLatLng([r.lat, r.lng]);
    map.panTo([r.lat, r.lng]);
    playbackIndex++;
  }, speed);
}

function pausePlayback() {
  if (playbackInterval) { clearInterval(playbackInterval); playbackInterval = null; }
}

function stopPlayback() {
  pausePlayback();
  playbackIndex = 0;
  if (playbackMarker) { map.removeLayer(playbackMarker); playbackMarker = null; }
}

// Wire playback controls
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'play-route') startPlayback();
  if (e.target && e.target.id === 'pause-route') pausePlayback();
  if (e.target && e.target.id === 'stop-route') stopPlayback();
});

// When history loads, populate playbackRows
async function showHistoryForDevice(deviceId) {
  try {
    const res = await fetch(`/api/history/${deviceId}?limit=200`);
    const rows = await res.json();
    playbackRows = rows.slice().reverse(); // chronological
    playbackIndex = 0;
    // draw polyline
    if (window.currentRouteLine) { map.removeLayer(window.currentRouteLine); window.currentRouteLine = null; }
    const latlngs = playbackRows.map(r => [r.lat, r.lng]);
    if (latlngs.length) {
      window.currentRouteLine = L.polyline(latlngs, { color: 'blue' }).addTo(map);
      map.fitBounds(window.currentRouteLine.getBounds(), { maxZoom: 18 });
    }

    const tableBody = document.querySelector('#gps-table tbody');
    tableBody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.lat.toFixed(6)}</td><td>${r.lng.toFixed(6)}</td><td>${new Date(r.createdAt).toLocaleString()}</td>`;
      tableBody.appendChild(tr);
    });

    // Update device basic info & battery chart
    if (rows.length) {
      const last = rows[0];
      document.getElementById('device-basic').textContent = `Last: ${new Date(last.createdAt).toLocaleString()} | Battery: ${last.battery ?? 'N/A'}%`;
      renderBatteryChart(rows, deviceId);
    } else {
      document.getElementById('device-basic').textContent = 'No history available.';
    }
  } catch (e) { console.error('History fetch error', e); }
}

async function showHistoryForDevice(deviceId) {
  try {
    const res = await fetch(`/api/history/${deviceId}?limit=200`);
    const rows = await res.json();
    const tableBody = document.querySelector('#gps-table tbody');
    tableBody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.lat.toFixed(6)}</td><td>${r.lng.toFixed(6)}</td><td>${new Date(r.createdAt).toLocaleString()}</td>`;
      tableBody.appendChild(tr);
    });

    // Update device basic info & battery chart
    if (rows.length) {
      const last = rows[0];
      document.getElementById('device-basic').textContent = `Last: ${new Date(last.createdAt).toLocaleString()} | Battery: ${last.battery ?? 'N/A'}%`;
      renderBatteryChart(rows, deviceId);
    } else {
      document.getElementById('device-basic').textContent = 'No history available.';
    }
  } catch (e) { console.error('History fetch error', e); }
}

// Update device list click handler to show history
function addOrUpdateDeviceList(id, info = {}) {
  const list = document.getElementById('device-list');
  let item = document.getElementById(`device-${id}`);
  if (!item) {
    item = document.createElement('button');
    item.id = `device-${id}`;
    item.className = 'list-group-item list-group-item-action';
    item.textContent = id;
    item.onclick = () => { document.getElementById('device-details').textContent = JSON.stringify(info); showHistoryForDevice(id); };
    list.prepend(item);
  } else {
    item.textContent = id;
  }
}

// Send command to device via backend
async function sendCommandToDevice(deviceId, command, params = {}) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, params }) });
    if (res.ok) addAlert(`Command ${command} sent to ${deviceId}`, 'info'); else addAlert(`Failed to send ${command}`, 'danger');
    // refresh commands list
    fetchCommands();
  } catch (e) { console.error('Command error', e); addAlert('Command error', 'danger'); }
}

// ---- Commands UI + API
let commands = [];
async function fetchCommands(deviceId = null) {
  try {
    const q = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
    const res = await fetch(`/api/commands${q}`);
    if (!res.ok) return;
    commands = await res.json();
    renderCommands();
  } catch (e) { console.error('fetchCommands err', e); }
}

function renderCommands() {
  const list = document.getElementById('commands-list');
  if (!list) return;
  list.innerHTML = '';
  commands.forEach(c => {
    const li = document.createElement('li');
    li.className = 'list-group-item list-group-item-light small d-flex justify-content-between align-items-start';
    const left = document.createElement('div');
    left.innerHTML = `<div><strong>${c.command}</strong> for <em>${c.deviceId}</em></div><div class="small text-muted">${new Date(c.createdAt).toLocaleString()} • ${c.status}</div>`;
    const right = document.createElement('div');
    const resendBtn = document.createElement('button'); resendBtn.className = 'btn btn-sm btn-outline-primary me-1'; resendBtn.textContent = 'Resend'; resendBtn.onclick = () => resendCommand(c.id);
    const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn btn-sm btn-outline-danger'; cancelBtn.textContent = 'Cancel'; cancelBtn.onclick = () => cancelCommand(c.id);
    right.appendChild(resendBtn); right.appendChild(cancelBtn);
    li.appendChild(left); li.appendChild(right);
    list.appendChild(li);
  });
}

async function cancelCommand(cmdId) {
  try {
    const res = await fetch(`/api/commands/${cmdId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
    if (res.ok) { addAlert('Command cancelled', 'info'); fetchCommands(); } else addAlert('Failed to cancel', 'danger');
  } catch (e) { console.error(e); addAlert('Cancel error', 'danger'); }
}

async function resendCommand(cmdId) {
  try {
    const res = await fetch(`/api/commands/${cmdId}/resend`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    if (res.ok) { addAlert('Command resent', 'info'); fetchCommands(); } else addAlert('Failed to resend', 'danger');
  } catch (e) { console.error(e); addAlert('Resend error', 'danger'); }
}

// socket events for commands
socket.on('deviceCommand', (payload) => {
  addAlert(`Command ${payload.command} -> ${payload.deviceId || payload.device}`, 'info');
  fetchCommands();
});
socket.on('commandAck', (ack) => {
  addAlert(`Command ${ack.id} acked by ${ack.deviceId}`, 'success');
  fetchCommands();
});
socket.on('commandUpdated', (u) => { fetchCommands(); });

// initial load
fetchCommands();

// Simple ping to server API to show it's alive
fetch('/api/gps').then(r => r.json()).then(() => console.log('Backend reachable')).catch(() => console.warn('Backend not reachable'));