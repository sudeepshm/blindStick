const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const turf = require('@turf/turf');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Config
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/geofence-db';

// Connect to MongoDB
mongoose.connect(MONGO_URI).catch(err => console.error('MongoDB connect error', err));
mongoose.connection.on('error', (err) => console.error('MongoDB connection error:', err));
mongoose.connection.once('open', () => console.log('Connected to MongoDB'));

// Schemas
const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  lastSeen: { type: Date, default: Date.now },
  battery: { type: Number },
  location: { lat: Number, lng: Number },
  meta: { type: Object }
});

const gpsSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  battery: { type: Number },
  distance: { type: Number }, // ultrasonic distance in cm
  puddle: { type: Boolean },
  accel: { type: Object },
  createdAt: { type: Date, default: Date.now }
});

const alertSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  type: { type: String, required: true },
  payload: { type: Object },
  createdAt: { type: Date, default: Date.now }
});

const geofenceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  geojson: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now },
});

const Device = mongoose.model('Device', deviceSchema);
const GPS = mongoose.model('GPS', gpsSchema);
const Alert = mongoose.model('Alert', alertSchema);
const Geofence = mongoose.model('Geofence', geofenceSchema);
// Command schema for queued device commands
const commandSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  command: { type: String, required: true },
  params: { type: Object },
  status: { type: String, enum: ['pending','delivered','done','cancelled'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0 }
});
const Command = mongoose.model('Command', commandSchema);

// POST: Save geofence
app.post('/api/geofence', async (req, res) => {
  try {
    const { name, geojson } = req.body;
    if (!geojson) return res.status(400).json({ message: 'Invalid geofence data.' });
    const g = new Geofence({ name, geojson });
    await g.save();
    io.emit('geofenceUpdated', g.geojson);
    res.status(200).json({ message: 'Geofence saved successfully.' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error while saving geofence.' }); }
});

// GET: list geofences
app.get('/api/geofence', async (req, res) => {
  try { const geofences = await Geofence.find().sort({ createdAt: -1 }); res.json(geofences); }
  catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// POST: Receive GPS coordinates and optional flags
app.post('/update-coords', async (req, res) => {
  try {
    const { deviceId, lat, lng, battery, sos, fall, distance, puddle, accel } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !deviceId) return res.status(400).json({ message: 'Invalid payload' });

    // Save GPS record (include sensor fields)
    const gps = new GPS({ deviceId, lat, lng, battery, distance, puddle, accel });
    await gps.save();

    // Upsert device
    await Device.findOneAndUpdate({ deviceId }, { deviceId, lastSeen: new Date(), battery, location: { lat, lng } }, { upsert: true, setDefaultsOnInsert: true });

    // Create alerts if needed
    if (sos) await new Alert({ deviceId, type: 'SOS', payload: { lat, lng, battery } }).save();
    if (fall) await new Alert({ deviceId, type: 'FALL', payload: { lat, lng, battery } }).save();
    if (typeof distance === 'number' && distance > 0 && distance < 30) {
      await new Alert({ deviceId, type: 'OBSTACLE', payload: { lat, lng, battery, distance } }).save();
    }
    if (puddle) {
      await new Alert({ deviceId, type: 'PUDDLE', payload: { lat, lng, battery } }).save();
    }
    // Check geofence breach: load geofences and verify point-in-polygon
    const point = turf.point([lng, lat]);
    const geofences = await Geofence.find();
    let insideAny = false;
    for (const g of geofences) {
      try {
        const geom = g.geojson && (g.geojson.type ? g.geojson : g.geojson.geometry ? g.geojson.geometry : null);
        if (!geom) continue;
        // Create a feature if necessary
        const feature = g.geojson.type ? g.geojson : g.geojson;
        if (turf.booleanPointInPolygon(point, feature)) { insideAny = true; break; }
      } catch (e) {
        console.warn('Geofence check error', e);
      }
    }

    // Read previous inside state from device
    const dev = await Device.findOne({ deviceId });
    const wasInside = dev && dev.meta && dev.meta.insideGeofence;
    if (!insideAny && wasInside !== false) {
      // Exited geofence
      await new Alert({ deviceId, type: 'GEOFENCE_EXIT', payload: { lat, lng, battery } }).save();
      // update device meta
      await Device.findOneAndUpdate({ deviceId }, { $set: { 'meta.insideGeofence': false } });
    } else if (insideAny && !wasInside) {
      // Re-entered geofence
      await new Alert({ deviceId, type: 'GEOFENCE_ENTER', payload: { lat, lng, battery } }).save();
      await Device.findOneAndUpdate({ deviceId }, { $set: { 'meta.insideGeofence': true } });
    }

    const payload = { id: deviceId, deviceId, lat, lng, battery, sos: !!sos, fall: !!fall, geofenceInside: insideAny, timestamp: new Date() };
    io.emit('locationUpdate', payload);
    res.sendStatus(200);
  } catch (err) { console.error('update-coords error', err); res.status(500).json({ message: 'Server error' }); }
});

// GET: devices
app.get('/api/devices', async (req, res) => {
  try { const devices = await Device.find().sort({ lastSeen: -1 }); res.json(devices); }
  catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// GET: history for a device
app.get('/api/history/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
    const rows = await GPS.find({ deviceId }).sort({ createdAt: -1 }).limit(limit);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// GET: recent alerts
app.get('/api/alerts', async (req, res) => {
  try { const alerts = await Alert.find().sort({ createdAt: -1 }).limit(200); res.json(alerts); }
  catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// POST: send command to device (relayed via Socket.IO)
// Simple API key middleware for protected routes
function requireApiKey(req, res, next) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return next(); // no API key configured, allow
  const provided = req.headers['x-api-key'] || req.query.api_key;
  if (provided && provided === apiKey) return next();
  return res.status(401).json({ message: 'Missing or invalid API key' });
}

app.post('/api/devices/:deviceId/command', requireApiKey, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { command, params } = req.body;
    if (!command) return res.status(400).json({ message: 'Missing command' });
    const payload = { deviceId, command, params: params || {}, issuedAt: new Date() };
    // save to DB for devices that poll
    const cmd = new Command({ deviceId, command, params: params || {} });
    await cmd.save();
    // also emit via socket.io for real-time listeners
    io.emit('deviceCommand', payload);
    res.json({ message: 'Command emitted and queued', payload });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Server error' }); }
});

// Device polls for pending commands; returned commands are marked 'delivered'
app.get('/api/devices/:deviceId/commands', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const cmds = await Command.find({ deviceId, status: 'pending' }).sort({ createdAt: 1 }).limit(50);
    if (cmds.length) {
      const ids = cmds.map(c => c._id);
      await Command.updateMany({ _id: { $in: ids } }, { $set: { status: 'delivered' } });
    }
    res.json(cmds.map(c => ({ id: c._id, command: c.command, params: c.params, createdAt: c.createdAt }))); 
  } catch (e) { console.error(e); res.status(500).json({ message: 'Server error' }); }
});

// Serve index
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Socket connection logs
io.on('connection', (socket) => {
  console.log('Socket connected', socket.id);
  socket.on('disconnect', () => console.log('Socket disconnected', socket.id));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Device acknowledges a command by id (marks done)
app.post('/api/devices/:deviceId/commands/:cmdId/ack', async (req, res) => {
  try {
    const { deviceId, cmdId } = req.params;
    const update = { status: 'done' };
    if (req.body && req.body.result) update.result = req.body.result;
    const cmd = await Command.findOneAndUpdate({ _id: cmdId, deviceId }, { $set: update }, { new: true });
    if (!cmd) return res.status(404).json({ message: 'Command not found' });
    // emit an event for monitoring UI
    io.emit('commandAck', { deviceId, id: cmd._id, status: cmd.status, result: cmd.result });
    res.json({ message: 'ACK recorded', id: cmd._id, status: cmd.status });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Server error' }); }
});

// Admin / UI: list commands, optional deviceId filter
app.get('/api/commands', async (req, res) => {
  try {
    const q = {};
    if (req.query.deviceId) q.deviceId = req.query.deviceId;
    const results = await Command.find(q).sort({ createdAt: -1 }).limit(200);
    res.json(results.map(r => ({ id: r._id, deviceId: r.deviceId, command: r.command, params: r.params, status: r.status, createdAt: r.createdAt, attempts: r.attempts })));
  } catch (e) { console.error(e); res.status(500).json({ message: 'Server error' }); }
});

// simple health endpoint for CI
app.get('/health', (req, res) => res.json({ ok: true }));

// Cancel a command (mark cancelled)
app.delete('/api/commands/:cmdId', requireApiKey, async (req, res) => {
  try {
    const { cmdId } = req.params;
    const cmd = await Command.findByIdAndUpdate(cmdId, { $set: { status: 'cancelled' } }, { new: true });
    if (!cmd) return res.status(404).json({ message: 'Command not found' });
    io.emit('commandUpdated', { id: cmd._id, status: cmd.status });
    res.json({ message: 'Cancelled', id: cmd._id });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Server error' }); }
});

// Resend a command: set it back to pending and bump attempts
app.post('/api/commands/:cmdId/resend', requireApiKey, async (req, res) => {
  try {
    const { cmdId } = req.params;
    const cmd = await Command.findById(cmdId);
    if (!cmd) return res.status(404).json({ message: 'Command not found' });
    cmd.status = 'pending';
    cmd.attempts = (cmd.attempts || 0) + 1;
    cmd.createdAt = new Date();
    await cmd.save();
    // emit the command again via socket
    io.emit('deviceCommand', { deviceId: cmd.deviceId, command: cmd.command, params: cmd.params, issuedAt: cmd.createdAt });
    io.emit('commandUpdated', { id: cmd._id, status: cmd.status });
    res.json({ message: 'Resent', id: cmd._id });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Server error' }); }
});