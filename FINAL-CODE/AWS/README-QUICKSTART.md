# Quickstart — Backend & Device Setup

This guide is written for a non-coder who can follow step-by-step instructions.

Prerequisites (PC):
- Windows 10/11 or macOS/Linux
- Node.js (v18+)
- npm
- MongoDB (local) or a MongoDB connection string (Atlas account)
- Arduino IDE (for flashing ESP8266) or PlatformIO + USB cable

Prerequisites (hardware per device):
- NodeMCU / ESP8266 board (e.g., NodeMCU v1.0)
- HC-SR04 ultrasonic sensor
- MPU6050 (I2C accel/gyro)
- Puddle sensor module (digital)
- Pushbutton (SOS)
- Vibration motor + transistor + diode + resistor
- Wires, breadboard, multimeter, micro USB cable

1) Prepare backend server

- Copy `.env.example` to `.env` and edit values:
```
PORT=3000
MONGO_URI=mongodb://localhost:27017/geofence-db
API_KEY=pick_a_strong_key
```
- Install and run the server:
```powershell
cd FINAL-CODE/AWS
npm install
node server.js
```
- Open http://localhost:3000 in a browser to view dashboard.

2) Flash firmware to NodeMCU

- Open `NODEMCU/firmware_examples/esp_telemetry.ino` in Arduino IDE.
- Edit the top settings: `WIFI_SSID`, `WIFI_PASS`, `SERVER_URL`, `DEVICE_ID`.
- Connect NodeMCU to PC via USB.
- Select `NodeMCU 1.0 (ESP-12E)` board and the correct COM port.
- Click Upload.

3) Wiring (pin mapping)

- MPU6050:
  - VCC -> 3.3V
  - GND -> GND
  - SDA -> D2
  - SCL -> D1
- HC-SR04:
  - VCC -> 5V
  - GND -> GND
  - TRIG -> D6
  - ECHO -> D7 (use voltage divider)
- Puddle sensor:
  - DO -> D5
  - VCC -> 5V
  - GND -> GND
- SOS button:
  - One side -> D3
  - Other side -> GND
- Vibration motor:
  - Use transistor switch, control pin -> D4

4) Basic tests

- Monitor Serial in Arduino IDE: verify WiFi connected and telemetry POST codes (200).
- Open dashboard — device marker should appear when telemetry arrives.

5) Sending Commands (Admin)

- Open http://<server>:3000/commands.html
- Enter the API key you put in `.env`.
- Use curl to send a command:
```
curl -X POST 'http://<server>:3000/api/devices/<deviceId>/command' -H 'Content-Type: application/json' -H 'x-api-key: <key>' -d '{"command":"vibrate","params":{}}'
```

Troubleshooting tips are included in the main `README.md`.
