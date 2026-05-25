ESP8266 Telemetry Example
=========================

This example sketch demonstrates how an ESP8266 (NodeMCU) can send GPS, battery, and SOS events to the project's backend `/update-coords` endpoint.

Quick setup
1. Edit `esp_telemetry.ino` and set `WIFI_SSID`, `WIFI_PASS`, and `SERVER_URL` to point at your server (e.g., `http://192.168.1.100:3000`).
2. Connect a push button for SOS to the pin defined by `SOS_PIN` (default `D3`) and ground; the sketch uses `INPUT_PULLUP`.
3. (Optional) Connect a GPS module TX->RX, RX->TX and parse NMEA with a GPS library. The example currently simulates GPS positions for easier testing.
4. (Optional) Use a voltage divider to measure battery voltage on `A0` and adjust calibration in `readBatteryPercent()`.
5. (Optional) Add `MPU6050` (I2C) for fall detection: connect SCL->D1, SDA->D2, VCC->3.3V, GND->GND. The sketch uses a simple magnitude-based threshold to detect falls.
6. (Optional) Connect HC-SR04 ultrasonic: `TRIG`->D6, `ECHO`->D7 and a puddle digital sensor to `D5` (configured with INPUT_PULLUP).
5. Compile & flash with Arduino IDE or PlatformIO.

Behavior
- Sends telemetry every 3 seconds to `/update-coords` with JSON: `{ deviceId, lat, lng, battery, sos, fall }`.
- The server responds with 200 on success; the frontend will receive Socket.IO `locationUpdate` events.

Notes
- Replace the simulated GPS code with a real GPS parser (TinyGPS++) if using a GPS module.
- Calibrate battery conversion for your hardware.
