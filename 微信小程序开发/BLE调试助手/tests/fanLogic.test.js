const assert = require('assert');

const {
  chooseSmartSpeedLevel,
  commandForMode,
  commandForPower,
  commandForSpeed,
  parseTelemetry,
  parseTelemetryPacket,
  parseSyncCode,
} = require('../utils/fanLogic');

assert.strictEqual(commandForPower(true), '00');
assert.strictEqual(commandForPower(false), '01');

assert.strictEqual(commandForMode('normal'), '02');
assert.strictEqual(commandForMode('swing'), '03');
assert.strictEqual(commandForMode('follow'), '04');

assert.strictEqual(commandForSpeed(1), '05');
assert.strictEqual(commandForSpeed(3), '07');
assert.strictEqual(commandForSpeed(5), '09');

assert.deepStrictEqual(parseTelemetry('T:26.5,H:60,S:3'), {
  temperature: 26.5,
  humidity: 60,
  speed: 3,
});

assert.deepStrictEqual(parseTelemetry('temp=30 hum=72 speed=4'), {
  temperature: 30,
  humidity: 72,
  speed: 4,
});

assert.deepStrictEqual(parseTelemetryPacket([0xff, 0x1a, 0x3c, 0x03, 0xfe]), {
  temperature: 26,
  humidity: 60,
  speed: 3,
  syncCode: null,
});

assert.deepStrictEqual(parseTelemetryPacket([0xff, 0x1a, 0x3c, 0x03, 0x07, 0xfe]), {
  temperature: 26,
  humidity: 60,
  speed: 3,
  syncCode: 7,
});

assert.strictEqual(parseTelemetryPacket([0xff, 0x1a, 0x3c, 0x03, 0x00]), null);
assert.strictEqual(parseTelemetryPacket([0x00, 0x1a, 0x3c, 0x03, 0xfe]), null);

assert.deepStrictEqual(parseSyncCode(0x00), {
  syncCode: 0,
  fanOn: true,
  smartMode: false,
});

assert.deepStrictEqual(parseSyncCode(0x04), {
  syncCode: 4,
  currentMode: 'follow',
  smartMode: false,
});

assert.deepStrictEqual(parseSyncCode(0x09), {
  syncCode: 9,
  fanOn: true,
  speedLevel: 5,
  smartMode: false,
});

assert.strictEqual(parseSyncCode(0x0a), null);

assert.strictEqual(chooseSmartSpeedLevel({ temperature: 21, humidity: 40 }), 1);
assert.strictEqual(chooseSmartSpeedLevel({ temperature: 24, humidity: 45 }), 2);
assert.strictEqual(chooseSmartSpeedLevel({ temperature: 27, humidity: 55 }), 3);
assert.strictEqual(chooseSmartSpeedLevel({ temperature: 30, humidity: 65 }), 4);
assert.strictEqual(chooseSmartSpeedLevel({ temperature: 33, humidity: 75 }), 5);

console.log('fanLogic tests passed');
