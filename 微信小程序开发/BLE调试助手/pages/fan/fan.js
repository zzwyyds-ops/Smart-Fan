const {
  chooseSmartSpeedLevel,
  commandForMode,
  commandForPower,
  commandForSpeed,
  parseTelemetry,
  parseTelemetryPacket,
  parseSyncCode,
} = require('../../utils/fanLogic');

const BLE_SERVICE_UUID = '0000FFE0-0000-1000-8000-00805F9B34FB';
const BLE_CHAR_UUID = '0000FFE1-0000-1000-8000-00805F9B34FB';
const app = getApp();

const MODES = [
  { key: 'normal', name: '普通模式', command: '02' },
  { key: 'swing', name: '摆头模式', command: '03' },
  { key: 'follow', name: '人物跟随模式', command: '04' },
];

const SPEED_LEVELS = [
  { level: 1, command: '05' },
  { level: 2, command: '06' },
  { level: 3, command: '07' },
  { level: 4, command: '08' },
  { level: 5, command: '09' },
];

const SCENES = [
  {
    key: 'sleep',
    name: '睡眠',
    detail: '普通 1档',
    tag: '60分钟定时',
    mode: 'normal',
    speedLevel: 1,
    timerMinutes: 60,
  },
  {
    key: 'comfort',
    name: '舒适',
    detail: '摆头 3档',
    tag: '立即生效',
    mode: 'swing',
    speedLevel: 3,
    timerMinutes: 0,
  },
  {
    key: 'boost',
    name: '强风',
    detail: '普通 5档',
    tag: '立即生效',
    mode: 'normal',
    speedLevel: 5,
    timerMinutes: 0,
  },
];

const MIN_COUNTDOWN_MINUTES = 1;
const MAX_COUNTDOWN_MINUTES = 720;
const SCENE_COMMAND_DELAY_MS = 500;

Page({
  data: {
    bleReady: false,
    scanning: false,
    connecting: false,
    connected: false,
    devices: [],
    _deviceMap: {},

    deviceName: '',
    deviceId: '',
    serviceId: '',
    notifyCharId: '',
    writeCharId: '',
    writeType: 'write',

    fanOn: false,
    currentMode: 'normal',
    speedLevel: 1,
    fanSpeedClass: 'fan-off',
    fanStatusText: '停止',
    currentSceneKey: '',
    currentSceneName: '',
    sceneBusy: false,
    smartMode: false,
    lastAutoLevel: 0,

    countdownMinutes: '30',
    closeAtTime: '22:00',
    timerActive: false,
    timerType: '',
    timerDisplay: '未设置',
    timerTargetText: '',

    temperature: '--',
    humidity: '--',
    speed: '--',
    telemetryText: '等待 STM32 回传数据',

    modes: MODES,
    speedLevels: SPEED_LEVELS,
    sceneOptions: SCENES,
    logs: [],
  },

  onLoad() {
    this.restorePersistedPageState();
    this.initBLE();
    this.syncGlobalDashboard();
  },

  onHide() {
    this.savePersistedPageState();
  },

  onUnload() {
    this.savePersistedPageState();
    this.stopScan();
    this.stopLocalFanTimer();
    wx.offBluetoothAdapterStateChange();
    wx.offBLEConnectionStateChange();
    if (this._bleCharacteristicHandler) {
      try {
        wx.offBLECharacteristicValueChange(this._bleCharacteristicHandler);
      } catch (err) {
        // Ignore runtime differences in off* callback signatures.
      }
    }
    this._bleCharacteristicHandler = null;
    wx.offBluetoothDeviceFound();
  },

  initBLE() {
    wx.openBluetoothAdapter({
      mode: 'central',
      success: () => {
        this.setData({ bleReady: true });
        this.bindBLEEvents();
        this.restoreGlobalConnection();
      },
      fail: () => {
        this.setData({ bleReady: false });
        wx.showToast({ title: '请打开手机蓝牙', icon: 'none' });
      },
    });
  },

  bindBLEEvents() {
    wx.onBluetoothAdapterStateChange((res) => {
      if (!res.available) {
        this.setData({
          bleReady: false,
          scanning: false,
          connecting: false,
          connected: false,
        });
        wx.showToast({ title: '蓝牙已关闭', icon: 'none' });
        return;
      }

      this.setData({ bleReady: true });
    });

    wx.onBLEConnectionStateChange((res) => {
      if (!res.connected) {
        this.clearGlobalConnection();
        this.setData({ connected: false, connecting: false });
        this.clearFanTimer();
        this.resetSceneState();
        this.syncGlobalDashboard({ connected: false });
        this.addLog('设备已断开');
      }
    });

    this._bleCharacteristicHandler = (res) => {
      const bytes = Array.from(new Uint8Array(res.value));
      let text = this.bufferToText(res.value);
      const hex = this.bufferToHex(res.value);
      const packetParsed = parseTelemetryPacket(bytes);
      if (packetParsed) {
        text = `HEX ${hex}`;
      }
      const parsed = packetParsed || parseTelemetry(text);
      const syncPatch = parsed ? parseSyncCode(parsed.syncCode) : null;
      const patch = {
        telemetryText: packetParsed ? `HEX ${hex}` : text || hex || '收到空数据',
      };

      if (parsed.temperature !== null) patch.temperature = parsed.temperature;
      if (parsed.humidity !== null) patch.humidity = parsed.humidity;
      if (parsed.speed !== null) patch.speed = parsed.speed;
      if (syncPatch) {
        Object.assign(patch, syncPatch, {
          currentSceneKey: '',
          currentSceneName: '',
          lastAutoLevel: syncPatch.smartMode === false ? 0 : this.data.lastAutoLevel,
        });
        if (syncPatch.speedLevel !== undefined || syncPatch.fanOn !== undefined) {
          const nextFanOn = syncPatch.fanOn !== undefined ? syncPatch.fanOn : this.data.fanOn;
          const nextSpeedLevel = syncPatch.speedLevel !== undefined ? syncPatch.speedLevel : this.data.speedLevel;
          Object.assign(patch, this.getFanMotionState(nextFanOn, nextSpeedLevel));
        }
      }

      this.setData(patch, () => {
        if (syncPatch && syncPatch.fanOn === false) {
          this.clearFanTimer();
        }
        this.syncGlobalDashboard();
      });
      this.addLog(`收到: ${text || hex}`);
      this.handleSmartMode(parsed);
    };
    wx.onBLECharacteristicValueChange(this._bleCharacteristicHandler);

    wx.onBluetoothDeviceFound((res) => {
      const deviceMap = this.data._deviceMap;
      const nextDevices = [...this.data.devices];

      (res.devices || []).forEach((device) => {
        if (!device || !device.deviceId || deviceMap[device.deviceId]) return;
        deviceMap[device.deviceId] = true;
        nextDevices.push({
          ...device,
          rssiLevel: this.rssiToLevel(device.RSSI),
        });
      });

      this.setData({ devices: nextDevices, _deviceMap: deviceMap });
    });
  },

  toggleScan() {
    if (this.data.scanning) {
      this.stopScan();
      return;
    }
    this.startScan();
  },

  startScan() {
    if (!this.data.bleReady) {
      wx.showToast({ title: '蓝牙未就绪', icon: 'none' });
      return;
    }

    this.setData({ scanning: true, devices: [], _deviceMap: {} });
    wx.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: false,
      powerLevel: 'high',
      fail: () => {
        this.setData({ scanning: false });
        wx.showToast({ title: '扫描失败', icon: 'none' });
      },
    });

    this.scanTimer = setTimeout(() => {
      if (this.data.scanning) this.stopScan();
    }, 10000);
  },

  stopScan() {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    wx.stopBluetoothDevicesDiscovery({
      complete: () => this.setData({ scanning: false }),
    });
  },

  connectDevice(e) {
    const device = e.currentTarget.dataset.device;
    if (!device || !device.deviceId) return;

    this.stopScan();
    this.setData({
      connecting: true,
      deviceName: device.name || device.localName || '未知设备',
      deviceId: device.deviceId,
    });
    wx.showLoading({ title: '连接中...' });

    wx.createBLEConnection({
      deviceId: device.deviceId,
      timeout: 10000,
      success: () => this.discoverServices(device.deviceId),
      fail: () => {
        wx.hideLoading();
        this.setData({ connecting: false });
        wx.showToast({ title: '连接失败', icon: 'none' });
      },
    });
  },

  discoverServices(deviceId) {
    wx.getBLEDeviceServices({
      deviceId,
      success: (res) => {
        const services = res.services || [];
        const service =
          services.find((item) => item.uuid.toUpperCase() === BLE_SERVICE_UUID) ||
          services.find((item) => item.uuid.toUpperCase().includes('FFE0')) ||
          services[0];

        if (!service) {
          this.finishConnectFail('未找到服务');
          return;
        }

        this.discoverCharacteristics(deviceId, service.uuid);
      },
      fail: () => this.finishConnectFail('获取服务失败'),
    });
  },

  discoverCharacteristics(deviceId, serviceId) {
    wx.getBLEDeviceCharacteristics({
      deviceId,
      serviceId,
      success: (res) => {
        const chars = res.characteristics || [];
        const notifyChar =
          chars.find((item) => item.uuid.toUpperCase() === BLE_CHAR_UUID && (item.properties.notify || item.properties.indicate)) ||
          chars.find((item) => item.properties.notify || item.properties.indicate) ||
          null;
        const writeChar =
          chars.find((item) => item.uuid.toUpperCase() === BLE_CHAR_UUID && (item.properties.write || item.properties.writeNoResponse || item.properties.writeDefault)) ||
          chars.find((item) => item.properties.write || item.properties.writeNoResponse || item.properties.writeDefault) ||
          null;

        if (!notifyChar && !writeChar) {
          this.finishConnectFail('未找到特征值');
          return;
        }

        this.enableNotify(deviceId, serviceId, notifyChar, writeChar);
      },
      fail: () => this.finishConnectFail('获取特征值失败'),
    });
  },

  enableNotify(deviceId, serviceId, notifyChar, writeChar) {
    const notifyCharId = notifyChar ? notifyChar.uuid : '';
    const writeCharId = writeChar ? writeChar.uuid : notifyCharId;
    const writeType = writeChar && writeChar.properties.writeNoResponse && !writeChar.properties.write ? 'writeNoResponse' : 'write';

    const onConnected = () => {
      wx.hideLoading();
      this.saveGlobalConnection({
        connected: true,
        deviceName: this.data.deviceName,
        deviceId,
        serviceId,
        notifyCharId,
        writeCharId,
        writeType,
      });
      this.setData({
        connected: true,
        connecting: false,
        serviceId,
        notifyCharId,
        writeCharId,
        writeType,
      });
      this.syncGlobalDashboard({ connected: true, deviceName: this.data.deviceName });
      this.addLog(`已连接 write=${this.shortUuid(writeCharId)} notify=${this.shortUuid(notifyCharId)}`);
      wx.showToast({ title: '连接成功', icon: 'success' });
    };

    if (!notifyCharId) {
      onConnected();
      return;
    }

    wx.notifyBLECharacteristicValueChange({
      deviceId,
      serviceId,
      characteristicId: notifyCharId,
      state: true,
      success: onConnected,
      fail: onConnected,
    });
  },

  finishConnectFail(message) {
    wx.hideLoading();
    this.setData({ connecting: false });
    wx.showToast({ title: message, icon: 'none' });
  },

  disconnect() {
    wx.closeBLEConnection({
      deviceId: this.data.deviceId,
      complete: () => {
        this.clearGlobalConnection();
        this.resetConnectionState();
        this.clearFanTimer();
        this.resetSceneState();
        wx.showToast({ title: '已断开', icon: 'none' });
      },
    });
  },

  closeBLEConnection() {
    if (this.data.deviceId && this.data.connected) {
      wx.closeBLEConnection({ deviceId: this.data.deviceId });
    }
    this.clearGlobalConnection();
    this.resetConnectionState();
    this.clearFanTimer();
    this.resetSceneState();
  },

  restoreGlobalConnection() {
    const saved = app.globalData.bleConnection || {};
    if (!saved.connected || !saved.deviceId || !saved.serviceId || !saved.writeCharId) {
      return;
    }

    this.setData({
      connected: true,
      connecting: false,
      deviceName: saved.deviceName || '已连接设备',
      deviceId: saved.deviceId,
      serviceId: saved.serviceId,
      notifyCharId: saved.notifyCharId || '',
      writeCharId: saved.writeCharId || '',
      writeType: saved.writeType || 'write',
    });
    this.syncGlobalDashboard({ connected: true, deviceName: saved.deviceName || '已连接设备' });
    this.addLog(`复用连接 write=${this.shortUuid(saved.writeCharId)} notify=${this.shortUuid(saved.notifyCharId)}`);
  },

  saveGlobalConnection(connection) {
    app.globalData.bleConnection = {
      ...app.globalData.bleConnection,
      ...connection,
    };
  },

  clearGlobalConnection() {
    app.globalData.bleConnection = {
      connected: false,
      deviceName: '',
      deviceId: '',
      serviceId: '',
      notifyCharId: '',
      writeCharId: '',
      writeType: 'write',
    };
  },

  resetConnectionState() {
    this.setData({
      connected: false,
      connecting: false,
      serviceId: '',
      notifyCharId: '',
      writeCharId: '',
      writeType: 'write',
    });
    this.syncGlobalDashboard({ connected: false });
  },

  togglePower() {
    if (this.data.sceneBusy) {
      wx.showToast({ title: '场景应用中', icon: 'none' });
      return;
    }
    const nextOn = !this.data.fanOn;
    this.sendCommand(commandForPower(nextOn), nextOn ? '打开风扇' : '关闭风扇', () => {
      if (!nextOn) this.clearFanTimer();
      this.resetSceneState();
      this.setData({
        fanOn: nextOn,
        ...this.getFanMotionState(nextOn, this.data.speedLevel),
      }, () => {
        this.syncGlobalDashboard();
      });
    });
  },

  selectMode(e) {
    if (this.data.sceneBusy) {
      wx.showToast({ title: '场景应用中', icon: 'none' });
      return;
    }
    const mode = e.currentTarget.dataset.mode;
    const option = MODES.find((item) => item.key === mode);
    this.sendCommand(commandForMode(mode), option ? option.name : '模式切换', () => {
      this.resetSceneState();
      this.setData({ currentMode: mode }, () => {
        this.syncGlobalDashboard();
      });
    });
  },

  selectSpeed(e) {
    if (this.data.sceneBusy) {
      wx.showToast({ title: '场景应用中', icon: 'none' });
      return;
    }
    if (this.data.smartMode) {
      return;
    }

    const level = Number(e.currentTarget.dataset.level);
    this.setSpeed(level, '手动风速');
  },

  toggleSmartMode() {
    if (this.data.sceneBusy) {
      wx.showToast({ title: '场景应用中', icon: 'none' });
      return;
    }
    const smartMode = !this.data.smartMode;
    this.setData({
      smartMode,
      lastAutoLevel: smartMode ? this.data.lastAutoLevel : 0,
    }, () => {
      this.syncGlobalDashboard({ currentSceneName: '' });
    });
    this.resetSceneState();
    this.addLog(smartMode ? '智能模式已开启' : '智能模式已关闭');

    if (smartMode) {
      this.applySmartSpeed();
    }
  },

  handleSmartMode(parsed) {
    if (!this.data.smartMode) return;
    if (parsed.temperature === null && parsed.humidity === null) return;
    this.applySmartSpeed();
  },

  applySmartSpeed() {
    const temperature = Number(this.data.temperature);
    const humidity = Number(this.data.humidity);
    if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) return;

    const level = chooseSmartSpeedLevel({ temperature, humidity });
    if (level === this.data.lastAutoLevel) return;

    this.setData({ lastAutoLevel: level });
    this.setSpeed(level, '智能风速');
  },

  setSpeed(level, label) {
    this.sendCommand(commandForSpeed(level), `${label} ${level}档`, () => {
      if (label !== '场景风速') {
        this.resetSceneState();
      }
      this.setData({
        speedLevel: level,
        ...this.getFanMotionState(this.data.fanOn, level),
      }, () => {
        this.syncGlobalDashboard();
      });
    });
  },

  applyScene(e) {
    const sceneKey = e.currentTarget.dataset.scene;
    const scene = SCENES.find((item) => item.key === sceneKey);
    if (!scene || this.data.sceneBusy) return;
    if (!this.data.connected || !this.data.writeCharId) {
      wx.showToast({ title: '请先连接设备', icon: 'none' });
      return;
    }

    const steps = [];
    if (!this.data.fanOn) {
      steps.push((next, fail) => {
        this.sendCommand(commandForPower(true), '场景打开风扇', () => {
          this.setData({
            fanOn: true,
            ...this.getFanMotionState(true, this.data.speedLevel),
          });
          next();
        }, fail);
      });
    }

    if (this.data.smartMode) {
      steps.push((next) => {
        this.setData({
          smartMode: false,
          lastAutoLevel: 0,
        });
        this.addLog('场景模式已接管');
        next();
      });
    }

    steps.push((next, fail) => {
      this.sendCommand(commandForMode(scene.mode), '场景模式', () => {
        this.setData({ currentMode: scene.mode });
        next();
      }, fail);
    });

    steps.push((next, fail) => {
      this.sendCommand(commandForSpeed(scene.speedLevel), '场景风速', () => {
        this.setData({
          speedLevel: scene.speedLevel,
          ...this.getFanMotionState(true, scene.speedLevel),
        });
        next();
      }, fail);
    });

    this.setData({ sceneBusy: true });
    this.runCommandSequence(steps, () => {
      this.setData({
        currentSceneKey: scene.key,
        currentSceneName: scene.name,
        sceneBusy: false,
      }, () => {
        this.syncGlobalDashboard();
      });
      this.applySceneTimer(scene);
      this.addLog(`场景已应用: ${scene.name}`);
    }, () => {
      this.setData({ sceneBusy: false });
    }, SCENE_COMMAND_DELAY_MS);
  },

  applySceneTimer(scene) {
    if (scene.timerMinutes > 0) {
      this.setData({ countdownMinutes: String(scene.timerMinutes) });
      this.startFanTimer({
        type: 'countdown',
        targetTime: Date.now() + scene.timerMinutes * 60 * 1000,
        targetText: `${scene.timerMinutes}分钟后关闭`,
      });
      return;
    }

    this.clearFanTimer();
  },

  runCommandSequence(steps, onDone, onFail, delayMs = 140) {
    if (!steps.length) {
      if (onDone) onDone();
      return;
    }

    const [step, ...rest] = steps;
    step(() => {
      setTimeout(() => {
        this.runCommandSequence(rest, onDone, onFail, delayMs);
      }, delayMs);
    }, (err) => {
      if (onFail) onFail(err);
    });
  },

  bindCountdownInput(e) {
    const rawValue = String(e.detail.value || '').replace(/[^\d]/g, '');
    this.setData({ countdownMinutes: rawValue });
  },

  bindCloseAtTime(e) {
    this.setData({ closeAtTime: e.detail.value });
  },

  startCountdownTimer() {
    if (this.data.sceneBusy) {
      wx.showToast({ title: '场景应用中', icon: 'none' });
      return;
    }
    const minutes = Number(this.data.countdownMinutes);
    if (!Number.isInteger(minutes) || minutes < MIN_COUNTDOWN_MINUTES || minutes > MAX_COUNTDOWN_MINUTES) {
      wx.showToast({ title: '请输入1-720分钟', icon: 'none' });
      return;
    }

    this.resetSceneState();
    const targetTime = Date.now() + minutes * 60 * 1000;
    this.startFanTimer({
      type: 'countdown',
      targetTime,
      targetText: `${minutes}分钟后关闭`,
    });
  },

  startCloseAtTimer() {
    if (this.data.sceneBusy) {
      wx.showToast({ title: '场景应用中', icon: 'none' });
      return;
    }
    const targetTime = this.getCloseAtTimestamp(this.data.closeAtTime);
    if (!targetTime) {
      wx.showToast({ title: '请选择关闭时间', icon: 'none' });
      return;
    }

    this.resetSceneState();
    this.startFanTimer({
      type: 'clock',
      targetTime,
      targetText: `${this.getCloseAtDayText(targetTime)} ${this.data.closeAtTime}关闭`,
    });
  },

  startFanTimer(options) {
    if (!this.data.connected || !this.data.writeCharId) {
      wx.showToast({ title: '请先连接设备', icon: 'none' });
      return;
    }
    if (!this.data.fanOn) {
      wx.showToast({ title: '请先打开风扇', icon: 'none' });
      return;
    }

    this.clearFanTimer();
    this.timerTargetTime = options.targetTime;
    this.setData({
      timerActive: true,
      timerType: options.type,
      timerTargetText: options.targetText,
      timerDisplay: this.formatTimerLeft(options.targetTime - Date.now()),
    }, () => {
      this.syncGlobalDashboard();
    });
    this.addLog(`定时关闭: ${options.targetText}`);

    this.fanTimer = setInterval(() => {
      this.refreshFanTimer();
    }, 1000);
  },

  refreshFanTimer() {
    if (!this.timerTargetTime) return;

    const remainMs = this.timerTargetTime - Date.now();
    if (remainMs <= 0) {
      this.finishFanTimer();
      return;
    }

    this.setData({ timerDisplay: this.formatTimerLeft(remainMs) }, () => {
      this.syncGlobalDashboard();
    });
  },

  finishFanTimer() {
    const targetText = this.data.timerTargetText;
    this.clearFanTimer();
    this.resetSceneState();
    this.sendCommand(commandForPower(false), '定时关闭风扇', () => {
      this.setData({
        fanOn: false,
        ...this.getFanMotionState(false, this.data.speedLevel),
      });
      this.addLog(`定时完成: ${targetText || '已关闭风扇'}`);
    });
  },

  cancelFanTimer() {
    if (!this.data.timerActive) return;
    this.resetSceneState();
    this.clearFanTimer();
    this.addLog('定时关闭已取消');
  },

  clearFanTimer() {
    this.stopLocalFanTimer();
    this.timerTargetTime = 0;
    if (this.data.timerActive || this.data.timerDisplay !== '未设置') {
      this.setData({
        timerActive: false,
        timerType: '',
        timerDisplay: '未设置',
        timerTargetText: '',
      }, () => {
        this.syncGlobalDashboard();
      });
    }
  },

  getCloseAtTimestamp(timeText) {
    const match = /^(\d{2}):(\d{2})$/.exec(timeText || '');
    if (!match) return 0;

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return 0;

    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  },

  getCloseAtDayText(targetTime) {
    const now = new Date();
    const target = new Date(targetTime);
    return target.getDate() === now.getDate() ? '今天' : '明天';
  },

  formatTimerLeft(remainMs) {
    const totalSeconds = Math.max(0, Math.ceil(remainMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}小时${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`;
    }
    return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  },

  restorePersistedPageState() {
    const saved = app.globalData.fanPageState || {};
    const patch = {
      fanOn: saved.fanOn !== undefined ? saved.fanOn : this.data.fanOn,
      currentMode: saved.currentMode || this.data.currentMode,
      speedLevel: saved.speedLevel || this.data.speedLevel,
      fanSpeedClass: saved.fanSpeedClass || this.data.fanSpeedClass,
      fanStatusText: saved.fanStatusText || this.data.fanStatusText,
      currentSceneKey: saved.currentSceneKey || '',
      currentSceneName: saved.currentSceneName || '',
      smartMode: saved.smartMode !== undefined ? saved.smartMode : this.data.smartMode,
      lastAutoLevel: saved.lastAutoLevel || 0,
      countdownMinutes: saved.countdownMinutes || this.data.countdownMinutes,
      closeAtTime: saved.closeAtTime || this.data.closeAtTime,
      timerActive: saved.timerActive || false,
      timerType: saved.timerType || '',
      timerDisplay: saved.timerDisplay || '未设置',
      timerTargetText: saved.timerTargetText || '',
      temperature: saved.temperature !== undefined ? saved.temperature : this.data.temperature,
      humidity: saved.humidity !== undefined ? saved.humidity : this.data.humidity,
      speed: saved.speed !== undefined ? saved.speed : this.data.speed,
      telemetryText: saved.telemetryText || this.data.telemetryText,
      logs: Array.isArray(saved.logs) ? saved.logs.slice(0, 30) : [],
    };

    patch.fanSpeedClass = patch.fanOn ? `fan-speed-${patch.speedLevel}` : 'fan-off';
    patch.fanStatusText = patch.fanOn ? `${patch.speedLevel}档` : '停止';
    this.setData(patch);

    this.timerTargetTime = Number(saved.timerTargetTimestamp) || 0;
    if (patch.timerActive && this.timerTargetTime > Date.now()) {
      this.setData({
        timerDisplay: this.formatTimerLeft(this.timerTargetTime - Date.now()),
      });
      this.resumePersistedTimer();
      return;
    }

    if (patch.timerActive) {
      this.timerTargetTime = 0;
      this.setData({
        timerActive: false,
        timerType: '',
        timerDisplay: '未设置',
        timerTargetText: '',
      });
    }
  },

  resumePersistedTimer() {
    if (!this.timerTargetTime || this.fanTimer) {
      return;
    }

    this.fanTimer = setInterval(() => {
      this.refreshFanTimer();
    }, 1000);
  },

  stopLocalFanTimer() {
    if (this.fanTimer) {
      clearInterval(this.fanTimer);
      this.fanTimer = null;
    }
  },

  getFanMotionState(fanOn, speedLevel) {
    return {
      fanSpeedClass: fanOn ? `fan-speed-${speedLevel}` : 'fan-off',
      fanStatusText: fanOn ? `${speedLevel}档` : '停止',
    };
  },

  getModeName(modeKey) {
    const match = MODES.find((item) => item.key === modeKey);
    return match ? match.name : '普通模式';
  },

  resetSceneState() {
    if (!this.data.currentSceneKey && !this.data.currentSceneName) {
      return;
    }
    this.setData({
      currentSceneKey: '',
      currentSceneName: '',
    }, () => {
      this.syncGlobalDashboard();
    });
  },

  syncGlobalDashboard(patch = {}) {
    const modeKey = patch.currentMode || this.data.currentMode;
    const next = {
      connected: patch.connected !== undefined ? patch.connected : this.data.connected,
      deviceName: patch.deviceName || this.data.deviceName || '未连接风扇',
      fanOn: patch.fanOn !== undefined ? patch.fanOn : this.data.fanOn,
      speedLevel: patch.speedLevel !== undefined ? patch.speedLevel : this.data.speedLevel,
      speed: patch.speed !== undefined ? patch.speed : this.data.speed,
      temperature: patch.temperature !== undefined ? patch.temperature : this.data.temperature,
      humidity: patch.humidity !== undefined ? patch.humidity : this.data.humidity,
      currentMode: modeKey,
      currentModeLabel: patch.currentModeLabel || this.getModeName(modeKey),
      smartMode: patch.smartMode !== undefined ? patch.smartMode : this.data.smartMode,
      timerDisplay: patch.timerDisplay || this.data.timerDisplay,
      timerTargetText: patch.timerTargetText !== undefined ? patch.timerTargetText : this.data.timerTargetText,
      currentSceneName: patch.currentSceneName !== undefined ? patch.currentSceneName : this.data.currentSceneName,
    };

    if (!next.connected) {
      next.deviceName = '未连接风扇';
    }

    app.globalData.fanDashboard = next;
    this.savePersistedPageState();
  },

  savePersistedPageState() {
    app.globalData.fanPageState = {
      fanOn: this.data.fanOn,
      currentMode: this.data.currentMode,
      speedLevel: this.data.speedLevel,
      fanSpeedClass: this.data.fanSpeedClass,
      fanStatusText: this.data.fanStatusText,
      currentSceneKey: this.data.currentSceneKey,
      currentSceneName: this.data.currentSceneName,
      smartMode: this.data.smartMode,
      lastAutoLevel: this.data.lastAutoLevel,
      countdownMinutes: this.data.countdownMinutes,
      closeAtTime: this.data.closeAtTime,
      timerActive: this.data.timerActive,
      timerType: this.data.timerType,
      timerDisplay: this.data.timerDisplay,
      timerTargetText: this.data.timerTargetText,
      timerTargetTimestamp: this.timerTargetTime || 0,
      temperature: this.data.temperature,
      humidity: this.data.humidity,
      speed: this.data.speed,
      telemetryText: this.data.telemetryText,
      logs: Array.isArray(this.data.logs) ? this.data.logs.slice(0, 30) : [],
    };
  },

  sendCommand(hex, label, afterSuccess, afterFail) {
    if (!this.data.connected || !this.data.writeCharId) {
      wx.showToast({ title: '请先连接设备', icon: 'none' });
      if (afterFail) afterFail(new Error('not_connected'));
      return;
    }

    const buffer = this.hexToBuffer(hex);
    wx.writeBLECharacteristicValue({
      deviceId: this.data.deviceId,
      serviceId: this.data.serviceId,
      characteristicId: this.data.writeCharId,
      value: buffer,
      writeType: this.data.writeType,
      success: () => {
        this.addLog(`${label} -> ${hex}h`);
        if (afterSuccess) afterSuccess();
      },
      fail: (err) => {
        this.addLog(`${label} 发送失败 ${err.errCode || ''}`);
        wx.showToast({ title: '发送失败', icon: 'none' });
        if (afterFail) afterFail(err);
      },
    });
  },

  addLog(text) {
    const time = this.formatTime(new Date());
    const logs = [{ time, text }, ...this.data.logs].slice(0, 30);
    this.setData({ logs }, () => {
      this.savePersistedPageState();
    });
  },

  hexToBuffer(hex) {
    const value = parseInt(hex, 16);
    return new Uint8Array([value]).buffer;
  },

  bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map((item) => item.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
  },

  bufferToText(buffer) {
    if (typeof TextDecoder !== 'undefined') {
      try {
        return new TextDecoder('utf-8').decode(buffer).replace(/\0+$/g, '').trim();
      } catch (err) {
        // Fall back to byte-wise decoding below.
      }
    }

    const bytes = new Uint8Array(buffer);
    let text = '';
    for (let i = 0; i < bytes.length; i += 1) {
      text += String.fromCharCode(bytes[i]);
    }
    return text.trim();
  },

  rssiToLevel(rssi) {
    if (rssi > -50) return 5;
    if (rssi > -65) return 4;
    if (rssi > -80) return 3;
    if (rssi > -90) return 2;
    return 1;
  },

  shortUuid(uuid) {
    return uuid ? uuid.slice(4, 8).toUpperCase() : 'none';
  },

  formatTime(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  },
});
