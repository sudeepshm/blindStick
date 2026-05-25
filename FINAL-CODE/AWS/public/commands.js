function saveApiKey() {
  const key = document.getElementById('api-key').value.trim();
  if (key) sessionStorage.setItem('api_key', key);
  return key;
}

function getApiKey() {
  return sessionStorage.getItem('api_key') || document.getElementById('api-key').value.trim();
}

async function fetchCommandsAdmin(deviceId, status) {
  try {
    const q = [];
    if (deviceId) q.push(`deviceId=${encodeURIComponent(deviceId)}`);
    const url = `/api/commands${q.length ? `?${q.join('&')}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error('fetch err', res.status);
      return [];
    }
    const data = await res.json();
    return status ? data.filter((d) => d.status === status) : data;
  } catch (e) {
    console.error(e);
    return [];
  }
}

function renderAdminList(items) {
  const list = document.getElementById('cmd-list');
  list.innerHTML = '';

  items.forEach((it) => {
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-start';
    li.innerHTML = `<div><strong>${it.command}</strong> <small class="text-muted">for ${it.deviceId}</small><div class="small text-muted">${new Date(it.createdAt).toLocaleString()} - ${it.status} - attempts:${it.attempts || 0}</div></div>`;

    const btns = document.createElement('div');
    const resend = document.createElement('button');
    resend.textContent = 'Resend';
    resend.className = 'btn btn-sm btn-outline-primary me-1';
    resend.onclick = () => doResend(it.id);

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.className = 'btn btn-sm btn-outline-danger';
    cancel.onclick = () => doCancel(it.id);

    btns.appendChild(resend);
    btns.appendChild(cancel);
    li.appendChild(btns);
    list.appendChild(li);
  });
}

async function doCancel(id) {
  saveApiKey();
  const key = getApiKey();
  if (!key) return alert('Set API key first');

  const res = await fetch(`/api/commands/${id}`, { method: 'DELETE', headers: { 'x-api-key': key } });
  if (res.ok) {
    alert('Cancelled');
    refresh();
  } else {
    alert('Cancel failed');
  }
}

async function doResend(id) {
  saveApiKey();
  const key = getApiKey();
  if (!key) return alert('Set API key first');

  const res = await fetch(`/api/commands/${id}/resend`, { method: 'POST', headers: { 'x-api-key': key } });
  if (res.ok) {
    alert('Resent');
    refresh();
  } else {
    alert('Resend failed');
  }
}

async function sendCommand() {
  saveApiKey();
  const key = getApiKey();
  if (!key) return alert('Set API key first');

  const deviceId = document.getElementById('send-device').value.trim();
  const command = document.getElementById('send-command').value;
  const paramsText = document.getElementById('send-params').value.trim();
  if (!deviceId) return alert('Enter a device ID');

  let params = {};
  if (paramsText) {
    try {
      params = JSON.parse(paramsText);
    } catch (e) {
      return alert('Params must be valid JSON');
    }
  }

  const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ command, params }),
  });

  if (res.ok) {
    alert('Command sent');
    document.getElementById('filter-device').value = deviceId;
    refresh();
  } else {
    const body = await res.json().catch(() => ({}));
    alert(body.message || 'Send failed');
  }
}

async function refresh() {
  const device = document.getElementById('filter-device').value.trim();
  const status = document.getElementById('filter-status').value;
  const items = await fetchCommandsAdmin(device, status);
  renderAdminList(items);
}

const savedKey = sessionStorage.getItem('api_key');
if (savedKey) document.getElementById('api-key').value = savedKey;

document.getElementById('apply-filters').addEventListener('click', () => {
  saveApiKey();
  refresh();
});
document.getElementById('refresh-btn').addEventListener('click', refresh);
document.getElementById('send-btn').addEventListener('click', sendCommand);

refresh();
