Release v1.0.0 - Firmware
=========================

This release contains the ESP8266 firmware source used for telemetry, sensor readings, and command polling.

Files included
- `esp_telemetry.ino` — ESP8266/NodeMCU sketch (source)

How to use
1. Open the Arduino IDE or PlatformIO and load `esp_telemetry.ino`.
2. Update the WiFi and `SERVER_URL` constants at the top of the sketch.
3. Install required libraries: `ESP8266WiFi`, `ESP8266HTTPClient`, `ArduinoJson`, `Wire`, `MPU6050`.
4. Compile and flash to an ESP8266 (NodeMCU/ESP-12) device.

Notes
- This release contains source code only. If you want me to attach compiled binaries (`.bin`), provide the compiled files or allow me to build them locally (requires Arduino/PlatformIO toolchain).
- To publish this as an actual GitHub Release draft (with attached assets) you can either:

  - Use the GitHub web UI: go to the repository Releases → Draft a new release → pick tag `v1.0.0` and attach `releases/firmware-v1.0.0/esp_telemetry.ino`.
  - Or use the GitHub CLI (if available and authenticated):

    gh release create v1.0.0 releases/firmware-v1.0.0/esp_telemetry.ino --title "v1.0.0" --notes-file releases/firmware-v1.0.0/RELEASE_NOTES.md --draft

Contact
If you'd like, I can attempt to build firmware binaries here (PlatformIO) and attach them to a release — tell me whether to proceed.
