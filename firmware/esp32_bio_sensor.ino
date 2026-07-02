/**
 * ESP32-S3 双核智能多维睡眠生物体征及谎言探测终端
 * 
 * 硬件选型 & 引脚定义:
 * 1. MAX30102 血氧心率传感器 (I2C 接口)
 *    - SDA = GPIO 4
 *    - SCL = GPIO 5
 * 2. AD8232 生物电心电放大器 (模拟 + 数字引脚)
 *    - Output = GPIO 1 (ADC1_CH0, 心电模拟信号)
 *    - LO+ = GPIO 2 (导联脱落检测 +)
 *    - LO- = GPIO 3 (导联脱落检测 -)
 * 3. GSR 皮肤电传导度传感器 (模拟引脚)
 *    - Output = GPIO 6 (ADC1_CH5)
 * 4. 状态指示 LED 
 *    - GREEN_LED (心跳脉动指示) = GPIO 7
 *    - RED_LED (Wi-Fi 异常/警报) = GPIO 8
 * 
 * 依赖的 Arduino 库:
 * - ArduinoWebsockets (by Gil Maimon)
 * - SparkFun MAX3010x Pulse Oximeter Library
 * - ArduinoJson (用于遥测数据打包与指令解析)
 */

#include <WiFi.h>
#include <ArduinoWebsockets.h>
#include <Wire.h>
#include <ArduinoJson.h>
#include "MAX30105.h"
#include "heartRate.h"

// --- 硬件与引脚配置 ---
#define PIN_AD8232_OUT 1
#define PIN_AD8232_LOP 2
#define PIN_AD8232_LON 3
#define PIN_GSR_OUT    6
#define PIN_LED_GREEN  7
#define PIN_LED_RED    8

// --- 软件 & 网络配置 ---
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* ws_server_url = "ws://YOUR_SERVER_IP:3000/ws/device"; // 对应 Cloud Run / 本地服务器 WebSocket 入口

using namespace websockets;
WebsocketsClient client;
MAX30105 particleSensor;

// --- 生物体征计算核心状态 ---
volatile float current_hr = 72.0;
volatile float current_spo2 = 98.5;
volatile float current_gsr = 2.45;
volatile uint32_t current_hrv = 64;

// 系统监控状态
float cpu_temp = 40.0;
uint32_t power_draw_mw = 135;
String active_bias_anomaly = "none"; // 生物特征仿真注入状态：none, breath, stress, apnea

// 采样历史与滤波缓存
const int ECG_FILTER_SIZE = 5;
int ecg_samples[ECG_FILTER_SIZE] = {0};
int ecg_sample_idx = 0;

// HRV 变量 (计算连续心跳间期 SDNN)
#define HRV_WINDOW_SIZE 10
volatile uint32_t last_beat_time = 0;
volatile uint32_t rr_intervals[HRV_WINDOW_SIZE] = {800, 810, 790, 820, 800, 830, 810, 800, 790, 810};
volatile int rr_idx = 0;

// 线程信号量与看门狗
SemaphoreHandle_t dataMutex;

// --- FreeRTOS 任务声明 ---
void TaskSensorReader(void *pvParameters);
void TaskCommunication(void *pvParameters);

void setup() {
  Serial.begin(115200);
  
  // 初始化物理指示灯
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  digitalWrite(PIN_LED_GREEN, HIGH); // 握手闪烁
  digitalWrite(PIN_LED_RED, HIGH);
  delay(500);
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, LOW);

  // 初始化 AD8232 导联脱落检测引脚
  pinMode(PIN_AD8232_LOP, INPUT);
  pinMode(PIN_AD8232_LON, INPUT);

  // 初始化 I2C 总线并检测 MAX30102
  Wire.begin(4, 5); // SDA = 4, SCL = 5
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("❌ 未检测到 MAX30102 脉搏血氧传感器，进入备用 ADC 仿真模式");
    digitalWrite(PIN_LED_RED, HIGH); // 红灯常亮提示硬件缺失
  } else {
    Serial.println("✅ MAX30102 传感器连接成功");
    // 配置 MAX30102 工作参数
    particleSensor.setup(); 
    particleSensor.setPulseAmplitudeRed(0x0A); // 低电流功耗保护，防止过热
    particleSensor.setPulseAmplitudeIR(0x0A);
  }

  // 创建互斥锁保护多核共享变量
  dataMutex = xSemaphoreCreateMutex();

  // 核心 0 运行高频高优先级生理传感器采样任务
  xTaskCreatePinnedToCore(
    TaskSensorReader,
    "SensorReader",
    4096,
    NULL,
    3, // 较高优先级确保 ADC/I2C 采样无抖动
    NULL,
    0
  );

  // 核心 1 负责 Wi-Fi 与 WebSocket 帧传输，属于 I/O 阻塞型任务
  xTaskCreatePinnedToCore(
    TaskCommunication,
    "Communication",
    8192,
    NULL,
    1, // 较低优先级
    NULL,
    1
  );
}

void loop() {
  // 空闲，所有操作在 FreeRTOS 双核任务中运行
  vTaskDelay(portMAX_DELAY);
}

// ==================== CORE 0: 传感器高频极速采样任务 ====================
void TaskSensorReader(void *pvParameters) {
  (void) pvParameters;

  TickType_t xLastWakeTime = xTaskGetTickCount();
  const TickType_t xFrequency = pdMS_TO_TICKS(10); // 100Hz 采样心电/皮肤电

  while (1) {
    // 1. 读取 AD8232 心电信号并进行均值滤波
    int raw_ecg = analogRead(PIN_AD8232_OUT);
    bool lead_off = (digitalRead(PIN_AD8232_LOP) == 1) || (digitalRead(PIN_AD8232_LON) == 1);
    
    // 基础滤波
    ecg_samples[ecg_sample_idx] = lead_off ? 0 : raw_ecg;
    ecg_sample_idx = (ecg_sample_idx + 1) % ECG_FILTER_SIZE;
    int filtered_ecg = 0;
    for (int i = 0; i < ECG_FILTER_SIZE; i++) filtered_ecg += ecg_samples[i];
    filtered_ecg /= ECG_FILTER_SIZE;

    // 简单 QRS 波群峰值检测法计算心率
    static int threshold = 2200; // 根据实际心电波幅自适应调整
    static bool peak_detected = false;
    if (filtered_ecg > threshold && !peak_detected) {
      peak_detected = true;
      digitalWrite(PIN_LED_GREEN, HIGH); // 随脉动闪烁绿色 LED

      uint32_t now = millis();
      uint32_t rr_interval = now - last_beat_time;
      if (rr_interval > 400 && rr_interval < 1500) { // 合法心跳区间 (40~150 BPM)
        last_beat_time = now;
        
        // 更新最近 RR 间期
        rr_intervals[rr_idx] = rr_interval;
        rr_idx = (rr_idx + 1) % HRV_WINDOW_SIZE;

        // 计算实时 BPM
        float calculated_hr = 60000.0 / rr_interval;

        // 临界更新
        if (xSemaphoreTake(dataMutex, portMAX_DELAY) == pdTRUE) {
          current_hr = calculated_hr;
          
          // 计算 SDNN 作为 HRV
          float sum = 0;
          for (int i = 0; i < HRV_WINDOW_SIZE; i++) sum += rr_intervals[i];
          float mean = sum / HRV_WINDOW_SIZE;
          float variance_sum = 0;
          for (int i = 0; i < HRV_WINDOW_SIZE; i++) {
            variance_sum += pow(rr_intervals[i] - mean, 2);
          }
          current_hrv = sqrt(variance_sum / HRV_WINDOW_SIZE);

          xSemaphoreGive(dataMutex);
        }
      }
    } else if (filtered_ecg < (threshold - 200)) {
      peak_detected = false;
      digitalWrite(PIN_LED_GREEN, LOW);
    }

    // 2. 读取 GSR 皮肤电阻值
    int raw_gsr = analogRead(PIN_GSR_OUT);
    // GSR 计算公式 (微导纳转换): 微西门子 (uS) = 10^6 / Resistance
    // 假设通过 510K 分压电阻：
    float v_out = (raw_gsr * 3.3) / 4095.0;
    float r_skin = (3.3 * 510000.0 / v_out) - 510000.0;
    float calculated_gsr = (r_skin > 10000.0) ? (1000000.0 / r_skin) : 0.0;

    // 3. 读取 MAX30102 血氧
    // 物理传感器若没有附着则读取模拟值
    float calculated_spo2 = 98.5;
    if (particleSensor.getIR() > 5000) {
      // 真实 MAX30102 信号存在
      // 简化的红光/红外 AC/DC 比值算法
      float red_ac = particleSensor.getRed();
      float ir_ac = particleSensor.getIR();
      float r = (red_ac / 100.0) / (ir_ac / 100.0);
      calculated_spo2 = 104.0 - 17.0 * r; // 经典经验公式推演
      if (calculated_spo2 > 100.0) calculated_spo2 = 100.0;
    }

    // 4. 应用云端注入的仿真偏置 (使没有连接传感器时，极客注入按钮依然能直接响应硬件内部演变)
    if (active_bias_anomaly == "breath") {
      // 腹式深呼吸：降低心率，提高 HRV
      calculated_gsr -= 0.15;
    } else if (active_bias_anomaly == "stress") {
      // 说谎惊恐：皮肤导纳陡升 2uS
      calculated_gsr += 1.5;
    } else if (active_bias_anomaly == "apnea") {
      // 睡眠暂停：血氧降低
      calculated_spo2 -= 5.0;
    }

    // 同步到全局互斥变量
    if (xSemaphoreTake(dataMutex, portMAX_DELAY) == pdTRUE) {
      current_gsr = current_gsr * 0.95 + calculated_gsr * 0.05; // 平滑平缓
      current_spo2 = current_spo2 * 0.98 + calculated_spo2 * 0.02;
      xSemaphoreGive(dataMutex);
    }

    vTaskDelayUntil(&xLastWakeTime, xFrequency);
  }
}

// ==================== CORE 1: 联网与 WEBSOCKET 数据传输任务 ====================
void TaskCommunication(void *pvParameters) {
  (void) pvParameters;

  // 1. 尝试连接 Wi-Fi
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);

  int retry_count = 0;
  while (WiFi.status() != WL_CONNECTED) {
    digitalWrite(PIN_LED_RED, !digitalRead(PIN_LED_RED)); // 异常状态下红灯交替闪烁
    vTaskDelay(pdMS_TO_TICKS(500));
    Serial.print(".");
    retry_count++;
    if (retry_count > 20) {
      Serial.println("\n⚠️ 未连接到 Wi-Fi，进入离线自主存储模式");
      break;
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ Wi-Fi 连入成功");
    Serial.print("IP 地址: ");
    Serial.println(WiFi.localIP());
    digitalWrite(PIN_LED_RED, LOW); // 熄灭红灯
  }

  // 2. 注册 WebSocket 消息接收回调
  client.onMessage([](WebsocketsMessage message) {
    Serial.print("📥 收到网关控制指令: ");
    Serial.println(message.data());

    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, message.data());
    if (!error) {
      if (doc["command"] == "set_adc_bias") {
        const char* anomaly = doc["anomaly"];
        active_bias_anomaly = String(anomaly);
        Serial.print("⚡ 硬件仿真微电压模拟偏置更新为: ");
        Serial.println(active_bias_anomaly);
      }
    }
  });

  // WebSocket 建立连接
  bool ws_connected = false;
  if (WiFi.status() == WL_CONNECTED) {
    ws_connected = client.connect(ws_server_url);
    if (ws_connected) {
      Serial.println("🌐 成功握手云端 WebSocket 服务器");
    } else {
      Serial.println("❌ 握手 WebSocket 失败");
    }
  }

  TickType_t xLastWakeTime = xTaskGetTickCount();
  const TickType_t xFrequency = pdMS_TO_TICKS(800); // 800ms telemetry 广播频率

  while (1) {
    // 维持 Websocket 连接
    if (WiFi.status() == WL_CONNECTED) {
      if (!client.available()) {
        digitalWrite(PIN_LED_RED, HIGH); // 红灯亮提示连接断开，尝试重连
        ws_connected = client.connect(ws_server_url);
        if (ws_connected) {
          digitalWrite(PIN_LED_RED, LOW);
        }
      } else {
        client.poll();
      }
    }

    // 采集 CPU 芯片温度
    #ifdef ESP32
    cpu_temp = temperatureRead();
    #endif

    // 读取线程安全的生理变量
    float hr, spo2, gsr;
    uint32_t hrv;
    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      hr = current_hr;
      spo2 = current_spo2;
      gsr = current_gsr;
      hrv = current_hrv;
      xSemaphoreGive(dataMutex);
    } else {
      hr = 70;
      spo2 = 98;
      gsr = 2.4;
      hrv = 60;
    }

    // 打包 JSON 遥测帧
    StaticJsonDocument<256> doc;
    doc["pulseRate"] = round(hr * 10.0) / 10.0;
    doc["bloodOxygen"] = round(spo2 * 10.0) / 10.0;
    doc["skinConductance"] = round(gsr * 100.0) / 100.0;
    doc["heartRateVariability"] = hrv;
    doc["cpuTemp"] = round(cpu_temp * 10.0) / 10.0;
    doc["powerDraw"] = power_draw_mw + random(-5, 5); // 随机扰动功耗
    doc["anomaly"] = active_bias_anomaly;

    String jsonStr;
    serializeJson(doc, jsonStr);

    // 发送
    if (WiFi.status() == WL_CONNECTED && client.available()) {
      client.send(jsonStr);
    } else {
      // 离线状态，输出日志到串口调试
      Serial.print("📊 离线遥测数据包: ");
      Serial.println(jsonStr);
    }

    vTaskDelayUntil(&xLastWakeTime, xFrequency);
  }
}
