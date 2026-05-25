const map = L.map('map').setView([25.1315, 55.4201], 16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
  draw: { rectangle: true, polygon: true, circle: false, marker: false },
  edit: { featureGroup: drawnItems },
});
map.addControl(drawControl);

const socket = io();
const markers = {};
let selectedDeviceId = null;
let batteryChart = null;
let commands = [];
let playbackInterval = null;
let playbackIndex = 0;
let playbackRows = [];
let playbackMarker = null;
let currentRouteLine = null;

map.on(L.Draw.Event.CREATED, async (event) => {
  const layer = event.layer;
  drawnItems.addLayer(layer);

  const payload = { name: `Geofence ${Date.now()}`, geojson: layer.toGeoJSON() };
  try {
    const response = await fetch('/api/geofence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    addAlert(response.ok ? 'Geofence saved' : 'Failed to save geofence', response.ok ? 'success' : 'danger');
  } catch (error) {
    console.error('Error saving geofence:', error);
    addAlert('Error saving geofence', 'danger');
  }
});

async function fetchGeofences() {
  try {
    const res = await fetch('/api/geofence');
    const geofences = await res.json();
    drawnItems.clearLayers();
    geofences.forEach((g) => L.geoJSON(g.geojson).eachLayer((layer) => drawnItems.addLayer(layer)));
  } catch (err) {
    console.error('Error fetching geofences:', err);
  }
}

function upsertDevice(id, lat, lng) {
  if (!markers[id]) {
    markers[id] = L.marker([lat, lng]).addTo(map);
    markers[id].bindPopup(id);
  } else {
    markers[id].setLatLng([lat, lng]);
  }
  markers[id].getPopup().setContent(`${id}: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
}

function updateTable(lat, lng, createdAt = new Date()) {
  const tableBody = document.querySelector('#gps-table tbody');
  const row = document.createElement('tr');
  row.innerHTML = `<td>${lat.toFixed(6)}</td><td>${lng.toFixed(6)}</td><td>${new Date(createdAt).toLocaleString()}</td>`;
  tableBody.prepend(row);
}

function addAlert(text, type = 'warning') {
  const alerts = document.getElementById('alerts');
  const el = document.createElement('div');
  el.className = `alert alert-${type} py-1 mb-1`;
  el.textContent = `${new Date().toLocaleTimeString()} - ${text}`;
  alerts.prepend(el);
}

function setSelectedDevice(id, info = {}) {
  selectedDeviceId = id;
  document.querySelectorAll('#device-list .list-group-item').forEach((el) => el.classList.remove('active'));
  const item = document.getElementById(`device-${id}`);
  if (item) item.classList.add('active');

  renderDeviceBasic(info);
  showHistoryForDevice(id);
  fetchCommands(id);
}

function addOrUpdateDeviceList(id, info = {}) {
  const list = document.getElementById('device-list');
  let item = document.getElementById(`device-${id}`);
  if (!item) {
    item = document.createElement('button');
    item.id = `device-${id}`;
    item.className = 'list-group-item list-group-item-action';
    item.type = 'button';
    item.onclick = () => setSelectedDevice(id, info);
    list.prepend(item);
  }

  const lastSeen = info.lastSeen || info.timestamp;
  item.textContent = lastSeen ? `${id} - ${new Date(lastSeen).toLocaleTimeString()}` : id;
}

function renderDeviceBasic(info = {}) {
  const basic = document.getElementById('device-basic');
  if (!basic) return;

  const parts = [];
  if (info.lastSeen || info.timestamp || info.createdAt) {
    parts.push(`Last: ${new Date(info.lastSeen || info.timestamp || info.createdAt).toLocaleString()}`);
  }
  parts.push(`Battery: ${info.battery ?? 'N/A'}%`);
  if (info.distance !== undefined) parts.push(`Distance: ${info.distance}cm`);
  if (info.puddle !== undefined) parts.push(`Puddle: ${info.puddle ? 'YES' : 'NO'}`);
  basic.textContent = parts.join(' | ');
}

socket.on('locationUpdate', (payload) => {
  const id = payload.id || payload.deviceId;
  const { lat, lng } = payload;
  if (!id || typeof lat !== 'number' || typeof lng !== 'number') return;

  upsertDevice(id, lat, lng);
  updateTable(lat, lng, payload.timestamp);
  addOrUpdateDeviceList(id, payload);

  if (!selectedDeviceId) setSelectedDevice(id, payload);
  if (selectedDeviceId === id) renderDeviceBasic(payload);

  if (payload.sos) addAlert(`SOS from ${id}`, 'danger');
  if (payload.fall) addAlert(`Fall detected on ${id}`, 'warning');
  if (payload.geofenceInside === false) addAlert(`Device ${id} left geofence`, 'warning');
  if (payload.geofenceInside === true) addAlert(`Device ${id} is inside geofence`, 'success');
});

async function showHistoryForDevice(deviceId) {
  try {
    const res = await fetch(`/api/history/${encodeURIComponent(deviceId)}?limit=200`);
    const rows = await res.json();
    playbackRows = rows.slice().reverse();
    playbackIndex = 0;

    if (currentRouteLine) map.removeLayer(currentRouteLine);
    const latlngs = playbackRows.map((r) => [r.lat, r.lng]);
    currentRouteLine = latlngs.length ? L.polyline(latlngs, { color: 'blue' }).addTo(map) : null;
    if (currentRouteLine) map.fitBounds(currentRouteLine.getBounds(), { maxZoom: 18 });

    const tableBody = document.querySelector('#gps-table tbody');
    tableBody.innerHTML = '';
    rows.forEach((r) => updateTable(r.lat, r.lng, r.createdAt));

    if (rows.length) {
      renderDeviceBasic(rows[0]);
      renderBatteryChart(rows);
    } else {
      document.getElementById('device-basic').textContent = 'No history available.';
      renderBatteryChart([]);
    }
  } catch (e) {
    console.error('History fetch error', e);
  }
}

function renderBatteryChart(rows) {
  const ctx = document.getElementById('battery-chart').getContext('2d');
  const data = rows.slice().reverse();
  const chartData = {
    labels: data.map((r) => new Date(r.createdAt).toLocaleTimeString()),
    datasets: [{
      label: 'Battery %',
      data: data.map((r) => r.battery ?? null),
      borderColor: '#0d6efd',
      backgroundColor: 'rgba(13,110,253,0.1)',
      tension: 0.2,
      fill: true,
    }],
  };

  if (batteryChart) {
    batteryChart.data = chartData;
    batteryChart.update();
    return;
  }

  batteryChart = new Chart(ctx, {
    type: 'line',
    data: chartData,
    options: { scales: { y: { beginAtZero: true, suggestedMax: 100 } } },
  });
}

function startPlayback() {
  const speed = parseInt(document.getElementById('playback-speed').value || '1000', 10);
  if (!playbackRows.length) return;
  pausePlayback();

  playbackInterval = setInterval(() => {
    const r = playbackRows[playbackIndex % playbackRows.length];
    if (!playbackMarker) playbackMarker = L.circleMarker([r.lat, r.lng], { radius: 8, color: 'red' }).addTo(map);
    playbackMarker.setLatLng([r.lat, r.lng]);
    map.panTo([r.lat, r.lng]);
    playbackIndex += 1;
  }, speed);
}

function pausePlayback() {
  if (playbackInterval) clearInterval(playbackInterval);
  playbackInterval = null;
}

function stopPlayback() {
  pausePlayback();
  playbackIndex = 0;
  if (playbackMarker) map.removeLayer(playbackMarker);
  playbackMarker = null;
}

async function fetchCommands(deviceId = selectedDeviceId) {
  try {
    const q = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
    const res = await fetch(`/api/commands${q}`);
    if (!res.ok) return;
    commands = await res.json();
    renderCommands();
  } catch (e) {
    console.error('fetchCommands error', e);
  }
}

function renderCommands() {
  const list = document.getElementById('commands-list');
  if (!list) return;
  list.innerHTML = '';

  commands.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'list-group-item list-group-item-light small d-flex justify-content-between align-items-start';

    const left = document.createElement('div');
    left.innerHTML = `<div><strong>${c.command}</strong> for <em>${c.deviceId}</em></div><div class="small text-muted">${new Date(c.createdAt).toLocaleString()} - ${c.status}</div>`;

    const right = document.createElement('div');
    const resendBtn = document.createElement('button');
    resendBtn.className = 'btn btn-sm btn-outline-primary me-1';
    resendBtn.textContent = 'Resend';
    resendBtn.onclick = () => resendCommand(c.id);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-sm btn-outline-danger';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => cancelCommand(c.id);

    right.appendChild(resendBtn);
    right.appendChild(cancelBtn);
    li.appendChild(left);
    li.appendChild(right);
    list.appendChild(li);
  });
}

function getApiKey() {
  return sessionStorage.getItem('api_key') || '';
}

async function sendProtectedCommand(url, options = {}) {
  const key = getApiKey();
  const headers = { ...(options.headers || {}) };
  if (key) headers['x-api-key'] = key;
  return fetch(url, { ...options, headers });
}

async function cancelCommand(cmdId) {
  try {
    const res = await sendProtectedCommand(`/api/commands/${cmdId}`, { method: 'DELETE' });
    addAlert(res.ok ? 'Command cancelled' : 'Failed to cancel command', res.ok ? 'info' : 'danger');
    fetchCommands();
  } catch (e) {
    console.error(e);
    addAlert('Cancel error', 'danger');
  }
}

async function resendCommand(cmdId) {
  try {
    const res = await sendProtectedCommand(`/api/commands/${cmdId}/resend`, { method: 'POST' });
    addAlert(res.ok ? 'Command resent' : 'Failed to resend command', res.ok ? 'info' : 'danger');
    fetchCommands();
  } catch (e) {
    console.error(e);
    addAlert('Resend error', 'danger');
  }
}

async function fetchDevices() {
  try {
    const res = await fetch('/api/devices');
    const devices = await res.json();
    devices.forEach((device) => {
      const lat = device.location && device.location.lat;
      const lng = device.location && device.location.lng;
      if (typeof lat === 'number' && typeof lng === 'number') upsertDevice(device.deviceId, lat, lng);
      addOrUpdateDeviceList(device.deviceId, device);
    });
  } catch (e) {
    console.error('fetchDevices error', e);
  }
}

async function fetchAlerts() {
  try {
    const res = await fetch('/api/alerts');
    const alerts = await res.json();
    alerts.reverse().forEach((alert) => addAlert(`${alert.type} from ${alert.deviceId}`, alert.type === 'SOS' ? 'danger' : 'warning'));
  } catch (e) {
    console.error('fetchAlerts error', e);
  }
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'play-route') startPlayback();
  if (e.target && e.target.id === 'pause-route') pausePlayback();
  if (e.target && e.target.id === 'stop-route') stopPlayback();
});

socket.on('deviceCommand', (payload) => {
  addAlert(`Command ${payload.command} -> ${payload.deviceId || payload.device}`, 'info');
  fetchCommands();
});
socket.on('commandAck', (ack) => {
  addAlert(`Command ${ack.id} acked by ${ack.deviceId}`, 'success');
  fetchCommands();
});
socket.on('commandUpdated', () => fetchCommands());
socket.on('geofenceUpdated', fetchGeofences);

fetch('/health').then((r) => r.json()).then(() => console.log('Backend reachable')).catch(() => console.warn('Backend not reachable'));
fetchGeofences();
fetchDevices();
fetchAlerts();
fetchCommands();
