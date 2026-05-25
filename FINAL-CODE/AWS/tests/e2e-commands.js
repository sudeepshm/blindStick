(async () => {
  try {
    const SERVER = process.env.SERVER_URL || 'http://localhost:3000';
    const DEVICE_ID = process.env.DEVICE_ID || 'test-device-1';
    const API_KEY = process.env.API_KEY;
    if (!API_KEY) { console.error('API_KEY required in env for E2E test'); process.exit(2); }

    console.log('Creating command...');
    const createRes = await fetch(`${SERVER}/api/devices/${DEVICE_ID}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY }, body: JSON.stringify({ command: 'vibrate', params: {} }) });
    if (!createRes.ok) { console.error('Create command failed', await createRes.text()); process.exit(1); }
    console.log('Command created');

    // find the command id
    let cmd = null;
    for (let i=0;i<10;i++) {
      const list = await fetch(`${SERVER}/api/commands?deviceId=${encodeURIComponent(DEVICE_ID)}`);
      const arr = await list.json();
      if (arr.length) { cmd = arr[0]; break; }
      await new Promise(r=>setTimeout(r,500));
    }
    if (!cmd) { console.error('Command not found'); process.exit(1); }
    console.log('Found command id', cmd.id || cmd._id);
    const cmdId = cmd.id || cmd._id;

    // Simulate device polling and ack
    console.log('Simulating device polling and ACK');
    const poll = await fetch(`${SERVER}/api/devices/${DEVICE_ID}/commands`);
    const pending = await poll.json();
    if (!pending.length) { console.error('No pending commands for device'); process.exit(1); }
    const p = pending[0];
    const ackRes = await fetch(`${SERVER}/api/devices/${DEVICE_ID}/commands/${p.id}/ack`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result: 'ok' }) });
    if (!ackRes.ok) { console.error('ACK failed', await ackRes.text()); process.exit(1); }
    console.log('ACK sent');

    // verify command marked done
    for (let i=0;i<10;i++) {
      const list = await fetch(`${SERVER}/api/commands?deviceId=${encodeURIComponent(DEVICE_ID)}`);
      const arr = await list.json();
      const found = arr.find(x => (x.id===cmdId || x._id===cmdId));
      if (found && found.status === 'done') { console.log('E2E success'); process.exit(0); }
      await new Promise(r=>setTimeout(r,500));
    }
    console.error('Command not marked done'); process.exit(1);
  } catch (e) { console.error(e); process.exit(1); }
})();
