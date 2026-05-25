/*
	ESP8266 Telemetry Example
	- Connects to WiFi
	- Reads (or simulates) GPS coordinates
	- Reads battery from A0 (via voltage divider)
	- Reads SOS button on a digital pin
	- POSTs JSON to server: /update-coords

	Configure WIFI_SSID, WIFI_PASS and SERVER_URL below before flashing.
*/

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <MPU6050.h>

// --- Configure ---
#define WIFI_SSID "your-ssid"
#define WIFI_PASS "your-pass"
#define SERVER_URL "http://192.168.1.100:3000" // change to your server
#define DEVICE_ID "node-1"

// Pins
#define SOS_PIN D3 // pull-down or pull-up depending on wiring
// Ultrasonic (HC-SR04) pins
#define US_TRIG D6
#define US_ECHO D7
// Puddle sensor digital pin
#define PUDDLE_PIN D5

// Telemetry interval (ms)
const unsigned long SEND_INTERVAL = 3000;

unsigned long lastSend = 0;
MPU6050 mpu;
int16_t ax, ay, az;
float prevMag = 0;
unsigned long lastPoll = 0;

// Vibration pin (haptic motor / buzzer)
#define VIBE_PIN D4

// Simulated route center (used when no GPS attached)
const double centerLat = 25.1315;
const double centerLng = 55.4201;

// Battery calibration: read A0, convert to percent (user should calibrate)
int readBatteryPercent() {
	int raw = analogRead(A0); // 0..1023
	// This is a rough mapping: raw 0->0% 1023->100%
	int pct = map(raw, 0, 1023, 0, 100);
	pct = constrain(pct, 0, 100);
	return pct;
}

// Read HC-SR04 distance in cm
long readUltrasonicCm() {
	digitalWrite(US_TRIG, LOW);
	delayMicroseconds(2);
	digitalWrite(US_TRIG, HIGH);
	delayMicroseconds(10);
	digitalWrite(US_TRIG, LOW);
	long duration = pulseIn(US_ECHO, HIGH, 30000); // timeout 30ms
	if (duration == 0) return -1;
	long cm = duration / 58;
	return cm;
}

bool readPuddle() {
	return digitalRead(PUDDLE_PIN) == LOW; // assume LOW means wet
}

// Simulate moving point around a circle
void simulatePosition(double &lat, double &lng) {
	unsigned long t = millis() / 1000;
	double angle = (t % 3600) / 3600.0 * 2.0 * 3.141592653589793;
	double r = 0.0005; // small radius
	lat = centerLat + sin(angle) * r;
	lng = centerLng + cos(angle) * r;
}

void sendTelemetry(double lat, double lng, int battery, bool sos, bool fall) {
	if (WiFi.status() != WL_CONNECTED) return;

	HTTPClient http;
	String url = String(SERVER_URL) + "/update-coords";
	http.begin(url);
	http.addHeader("Content-Type", "application/json");

	StaticJsonDocument<256> doc;
	doc["deviceId"] = DEVICE_ID;
	doc["lat"] = lat;
	doc["lng"] = lng;
	doc["battery"] = battery;
	doc["sos"] = sos;
	doc["fall"] = fall;

	String body;
	serializeJson(doc, body);

	int code = http.POST(body);
	if (code > 0) {
		Serial.printf("Sent telemetry, code=%d\n", code);
	} else {
		Serial.printf("Error sending: %s\n", http.errorToString(code).c_str());
	}
	http.end();
}

void setup() {
	Serial.begin(115200);
	delay(100);
	pinMode(SOS_PIN, INPUT_PULLUP);
	pinMode(US_TRIG, OUTPUT);
	pinMode(US_ECHO, INPUT);
	pinMode(PUDDLE_PIN, INPUT_PULLUP);
	pinMode(VIBE_PIN, OUTPUT);

	Wire.begin();
	mpu.initialize();
	if (mpu.testConnection()) Serial.println("MPU6050 connected"); else Serial.println("MPU6050 not found");

	WiFi.mode(WIFI_STA);
	WiFi.begin(WIFI_SSID, WIFI_PASS);
	Serial.print("Connecting WiFi");
	unsigned long start = millis();
	while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
		Serial.print('.');
		delay(500);
	}
	Serial.println();
	if (WiFi.status() == WL_CONNECTED) Serial.println("WiFi connected"); else Serial.println("WiFi failed");
}

void loop() {
	unsigned long now = millis();
	if (now - lastSend < SEND_INTERVAL) {
		delay(50);
		return;
	}
	lastSend = now;

	double lat = 0, lng = 0;
	// For simplicity, simulate GPS. Replace this with a real GPS parser if available.
	simulatePosition(lat, lng);

	int battery = readBatteryPercent();
	bool sos = (digitalRead(SOS_PIN) == LOW); // pressed if using pullup
	bool fall = false; // placeholder for MPU detection
	long distance = readUltrasonicCm();
	bool puddle = readPuddle();

	// Read MPU6050 accelerometer and compute magnitude
	if (mpu.testConnection()) {
		mpu.getAcceleration(&ax, &ay, &az);
		float gx = ax / 16384.0;
		float gy = ay / 16384.0;
		float gz = az / 16384.0;
		float mag = sqrt(gx*gx + gy*gy + gz*gz);
		// simple fall detection: large spike or sustained near-zero (free fall)
		if (mag > 3.0 || (prevMag > 0 && fabs(mag - prevMag) > 2.5)) {
			fall = true;
		}
		prevMag = mag;
	}

	Serial.printf("Telemetry: %f,%f bat=%d sos=%d\n", lat, lng, battery, sos);
	// include sensor fields in payload
	if (distance >= 0) {
		// adapt sendTelemetry to send extra args via JSON directly here
	}

	// Build JSON and send
	if (WiFi.status() == WL_CONNECTED) {
		HTTPClient http;
		String url = String(SERVER_URL) + "/update-coords";
		http.begin(url);
		http.addHeader("Content-Type", "application/json");

		StaticJsonDocument<512> doc;
		doc["deviceId"] = DEVICE_ID;
		doc["lat"] = lat;
		doc["lng"] = lng;
		doc["battery"] = battery;
		doc["sos"] = sos;
		doc["fall"] = fall;
		if (distance >= 0) doc["distance"] = distance;
		doc["puddle"] = puddle;

		String body;
		serializeJson(doc, body);
		int code = http.POST(body);
		if (code > 0) Serial.printf("Sent telemetry, code=%d\n", code); else Serial.printf("Error sending: %s\n", http.errorToString(code).c_str());
		http.end();
	}

	// Poll for commands every 5 seconds
	if (millis() - lastPoll > 5000 && WiFi.status() == WL_CONNECTED) {
		lastPoll = millis();
		HTTPClient hc;
		String url = String(SERVER_URL) + "/api/devices/" + DEVICE_ID + "/commands";
		hc.begin(url);
		int ccode = hc.GET();
		if (ccode == 200) {
			String body = hc.getString();
			StaticJsonDocument<1024> doc;
			DeserializationError err = deserializeJson(doc, body);
			if (!err) {
				for (JsonObject item : doc.as<JsonArray>()) {
					const char* cmd = item["command"];
					const char* id = item["id"] | "";
					JsonObject params = item["params"].as<JsonObject>();
					if (strcmp(cmd, "vibrate") == 0) {
						digitalWrite(VIBE_PIN, HIGH);
						delay(200);
						digitalWrite(VIBE_PIN, LOW);
						// ACK the command
						if (strlen(id) > 0) {
							HTTPClient ack;
							String aurl = String(SERVER_URL) + "/api/devices/" + DEVICE_ID + "/commands/" + id + "/ack";
							ack.begin(aurl);
							ack.addHeader("Content-Type", "application/json");
							int acode = ack.POST("{\"result\":\"vibrated\"}");
							if (acode > 0) Serial.printf("ACK %d\n", acode);
							ack.end();
						}
					} else if (strcmp(cmd, "say") == 0) {
						const char* text = params["text"] | "";
						Serial.printf("VOICE: %s\n", text);
						if (strlen(id) > 0) {
							HTTPClient ack2;
							String aurl2 = String(SERVER_URL) + "/api/devices/" + DEVICE_ID + "/commands/" + id + "/ack";
							ack2.begin(aurl2);
							ack2.addHeader("Content-Type", "application/json");
							int acode2 = ack2.POST("{\"result\":\"said\"}");
							if (acode2 > 0) Serial.printf("ACK %d\n", acode2);
							ack2.end();
						}
					}
				}
			}
		}
		hc.end();
	}
}
