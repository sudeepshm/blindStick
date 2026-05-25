// Simple device simulator: posts to /update-coords on localhost:3000
// Usage: node dev-simulator.js

const fetch = global.fetch || require('node-fetch');

const SERVER = process.env.SERVER || 'http://localhost:3000';
const DEVICE_ID = process.env.DEVICE_ID || 'sim-1';

// Example route: small square around a center
const center = { lat: 25.1315, lng: 55.4201 };
const route = [];
for (let i = 0; i < 36; i++) {
  const angle = (i / 36) * Math.PI * 2;
  const r = 0.0005; // ~50m
  route.push({ lat: center.lat + Math.sin(angle) * r, lng: center.lng + Math.cos(angle) * r });
}

let idx = 0;
let battery = 100;

function randChance(p) { return Math.random() < p; }

async function sendPoint() {
  const pos = route[idx % route.length];
  idx++;
  // occasional events
  const sos = randChance(0.01); // 1% chance
  const fall = !sos && randChance(0.02); // 2% chance
  battery = Math.max(5, battery - (Math.random() * 0.2));

  const payload = {
    deviceId: DEVICE_ID,
    lat: Number(pos.lat.toFixed(6)),
    lng: Number(pos.lng.toFixed(6)),
    battery: Math.round(battery),
    sos: sos,
    fall: fall
  };

  try {
    const res = await fetch(`${SERVER}/update-coords`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    console.log('sent', payload, 'status', res.status);
  } catch (e) {
    console.error('send error', e.message || e);
  }
}

console.log(`Device simulator started -> ${SERVER}/update-coords as ${DEVICE_ID}`);
sendPoint();
setInterval(sendPoint, 3000);
