# Quickstart - Backend & Device Setup

This guide is written for a non-coder who can follow step-by-step instructions.

## Prerequisites

PC:
- Windows 10/11 or macOS/Linux
- Node.js v18+
- npm
- MongoDB local, or a MongoDB Atlas connection string
- Arduino IDE or PlatformIO plus a USB cable for flashing the ESP8266

Hardware per device:
- NodeMCU / ESP8266 board, such as NodeMCU v1.0
- HC-SR04 ultrasonic sensor
- MPU6050 I2C accelerometer/gyro
- Puddle sensor module
- SOS pushbutton
- Vibration motor or buzzer plus transistor, diode, and resistor
- Wires, breadboard, multimeter, and micro USB cable

## 1. Prepare the backend server

Copy `.env.example` to `.env` and edit the values:

```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/geofence-db
API_KEY=pick_a_strong_key
```

Install and run the server:

```powershell
cd FINAL-CODE/AWS
npm install
node server.js
```

Open `http://localhost:3000` in a browser to view the dashboard.

## 2. Flash firmware to NodeMCU

- Open `NODEMCU/firmware_examples/esp_telemetry.ino` in Arduino IDE.
- Edit the top settings: `WIFI_SSID`, `WIFI_PASS`, `SERVER_URL`, and `DEVICE_ID`.
- Connect NodeMCU to the PC via USB.
- Select `NodeMCU 1.0 (ESP-12E)` and the correct COM port.
- Click Upload.

## 3. Wiring

MPU6050:
- VCC -> 3.3V
- GND -> GND
- SDA -> D2
- SCL -> D1

HC-SR04:
- VCC -> 5V
- GND -> GND
- TRIG -> D6
- ECHO -> D7 through a voltage divider

Puddle sensor:
- DO -> D5
- VCC -> 5V
- GND -> GND

SOS button:
- One side -> D3
- Other side -> GND

Vibration motor:
- Use a transistor switch
- Control pin -> D4

## 4. Basic tests

- Monitor Serial in Arduino IDE and verify WiFi connects.
- Confirm telemetry POST status codes are `200`.
- Open the dashboard. The device marker should appear when telemetry arrives.

## 5. Sending commands

Open `http://<server>:3000/commands.html`.

Enter the API key from `.env`, then send a command from the form. You can also use curl:

```bash
curl -X POST "http://<server>:3000/api/devices/<deviceId>/command" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <key>" \
  -d "{\"command\":\"vibrate\",\"params\":{}}"
```

Troubleshooting tips are included in the main `README.md`.
