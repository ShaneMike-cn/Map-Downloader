<template>
  <div class="app-container">
    <!-- 左侧：控制面板 -->
    <div class="sidebar">
      <div class="brand">
        <h1>🗺️ 地图瓦片下载器</h1>
        <p>瓦片下载与管理</p>
      </div>

      <!-- 导航选项卡 -->
      <div class="nav-tabs">
        <button
          :class="['tab-button', { active: activeTab === 'download' }]"
          @click="activeTab = 'download'"
        >
          📥 下载地图
        </button>
        <button
          :class="['tab-button', { active: activeTab === 'manage' }]"
          @click="
            activeTab = 'manage';
            fetchDownloads();
          "
        >
          📂 离线管理
        </button>
      </div>

      <div class="scroll-content">
        <!-- 下载地图面板 -->
        <div v-show="activeTab === 'download'">
          <!-- 1. 地图源设置 -->
          <section class="card">
            <div class="card-header">
              <span class="icon">📡</span>
              <h3>地图源</h3>
            </div>
            <div class="form-item">
              <label>预设</label>
              <select v-model="selectedPresetIndex" @change="applyPreset">
                <option
                  v-for="(preset, index) in mapPresets"
                  :key="index"
                  :value="index.toString()"
                >
                  {{ preset.name }}
                </option>
              </select>
            </div>

            <div class="form-item">
              <label>URL 模板</label>
              <input v-model="config.url" type="text" class="code-input" />
            </div>

            <div v-if="currentPreset.needsKey" class="form-item">
              <label>API 密钥</label>
              <input
                v-model="config.apiKey"
                type="text"
                @input="updateUrlWithKey"
              />
            </div>
          </section>

          <!-- 2. 缩放级别与范围概览 -->
          <section class="card">
            <div class="card-header">
              <span class="icon">🔍</span>
              <h3>缩放级别与范围</h3>
            </div>
            <div class="zoom-inputs">
              <div class="input-wrap">
                <label>最小缩放</label>
                <input
                  type="number"
                  v-model.number="config.minZoom"
                  min="0"
                  max="20"
                />
              </div>
              <div class="separator">-</div>
              <div class="input-wrap">
                <label>最大缩放</label>
                <input
                  type="number"
                  v-model.number="config.maxZoom"
                  min="0"
                  max="20"
                />
              </div>
            </div>

            <!-- 选中区域的简要信息 -->
            <div class="info-box" :class="{ active: hasValidBounds }">
              <div v-if="hasValidBounds">
                <strong>准备下载</strong><br />
                <small>
                  北: {{ manualBounds.north }}<br />
                  南: {{ manualBounds.south }}<br />
                  西: {{ manualBounds.west }}<br />
                  东: {{ manualBounds.east }}
                </small>
              </div>
              <div v-else class="warning">请定义一个区域 (绘制或输入) →</div>
            </div>
          </section>

          <!-- 3. MinIO 存储配置 -->
          <section class="card">
            <div class="card-header">
              <span class="icon">☁️</span>
              <h3>存储</h3>
              <label class="switch">
                <input type="checkbox" v-model="config.uploadToMinio" />
                <span class="slider round"></span>
              </label>
            </div>
            <div v-if="config.uploadToMinio" class="minio-grid">
              <div class="form-item full-width">
                <label>端点</label>
                <input
                  v-model="config.minio.endPoint"
                  placeholder="例如: play.min.io"
                />
              </div>
              <div class="form-item">
                <label>端口</label>
                <input
                  v-model.number="config.minio.port"
                  type="number"
                  placeholder="例如: 9000"
                />
              </div>
              <div class="form-item">
                <label>存储桶</label>
                <input v-model="config.minio.bucket" placeholder="例如: maps" />
              </div>
              <div class="form-item full-width">
                <label>访问密钥</label>
                <input
                  v-model="config.minio.accessKey"
                  placeholder="Access Key"
                />
              </div>
              <div class="form-item full-width">
                <label>私密密钥</label>
                <input
                  v-model="config.minio.secretKey"
                  placeholder="Secret Key"
                  type="password"
                />
              </div>
              <div class="form-item">
                <label class="switch">
                  <input type="checkbox" v-model="config.minio.useSSL" />
                  <span class="slider round"></span>
                  启用SSL
                </label>
              </div>
            </div>
          </section>
        </div>

        <!-- 下载管理面板 -->
        <div v-show="activeTab === 'manage'">
          <section class="card">
            <div class="card-header">
              <span class="icon">📂</span>
              <h3>已下载地图</h3>
              <button @click="fetchDownloads" class="btn-refresh">🔄</button>
            </div>

            <!-- 批量操作栏 -->
            <div v-if="downloads.length > 0" class="bulk-actions">
              <label class="checkbox-inline">
                <input
                  type="checkbox"
                  :checked="
                    selectedDownloads.length === downloads.length &&
                    downloads.length > 0
                  "
                  @change="toggleSelectAll"
                />
                全选
              </label>
              <button
                @click="packageDownloads"
                :disabled="selectedDownloads.length === 0"
                class="btn btn-secondary"
              >
                📦 打包下载 ({{ selectedDownloads.length }})
              </button>
            </div>

            <div class="downloads-list">
              <div v-if="downloads.length === 0" class="empty-state">
                暂无下载记录
              </div>

              <div v-else>
                <div
                  v-for="download in downloads"
                  :key="download.id"
                  class="download-item"
                >
                  <div class="download-select">
                    <input
                      type="checkbox"
                      :checked="selectedDownloads.includes(download.id)"
                      @change="toggleSelection(download.id)"
                    />
                  </div>
                  <div class="download-info">
                    <div class="download-name">{{ download.name }}</div>
                    <div class="download-meta">
                      <span
                        >缩放: {{ download.minZoom }}-{{
                          download.maxZoom
                        }}</span
                      >
                      <span>瓦片: {{ download.tileCount }}</span>
                      <span>大小: {{ formatFileSize(download.fileSize) }}</span>
                    </div>
                    <div class="download-bounds">
                      北: {{ download.north.toFixed(4) }}, 南:
                      {{ download.south.toFixed(4) }}, 西:
                      {{ download.west.toFixed(4) }}, 东:
                      {{ download.east.toFixed(4) }}
                    </div>
                    <div class="download-time">
                      {{ new Date(download.downloadTime).toLocaleString() }}
                    </div>
                  </div>

                  <div class="download-actions">
                    <button
                      @click="previewRecord(download)"
                      class="btn-action"
                    >
                      👁️ 预览
                    </button>
                    <button
                      @click="deleteDownload(download.id)"
                      class="btn-action danger"
                    >
                      🗑️ 删除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div class="sidebar-footer">
        <!-- 下载面板的操作按钮 -->
        <template v-if="activeTab === 'download'">
          <button
            v-if="!isDownloading"
            @click="startDownload"
            :disabled="!hasValidBounds"
            class="btn btn-primary"
          >
            开始下载
          </button>

          <button
            v-else
            @click="cancelDownload"
            class="btn btn-danger"
          >
            <span class="spinner"></span> 取消下载
          </button>

          <button
            @click="previewDraft"
            class="btn btn-secondary"
          >
            预览结果 (当前设置)
          </button>
        </template>
        
        <!-- 管理面板的底部提示（可选） -->
        <template v-if="activeTab === 'manage'">
           <div class="panel-tip">提示：点击列表中的预览按钮查看离线地图</div>
        </template>

        <!-- 日志 -->
        <div class="log-viewer" ref="logContainer">
          <div v-for="(log, i) in logs" :key="i" class="log-line">
            <span class="time">{{ log.time }}</span> {{ log.msg }}
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧：地图区域 -->
    <div class="map-wrapper">
      <div id="amap-container" class="map-view"></div>

      <!-- 新增：自定义坐标/画图面板 -->
      <div class="coords-panel">
        <h4>📐 自定义区域</h4>

        <!-- 画图工具按钮 -->
        <div class="tool-bar">
          <button
            @click="toggleDrawRect"
            class="btn-tool"
            :class="{ active: isDrawing }"
          >
            {{ isDrawing ? "正在绘制... (释放完成)" : "🖱️ 在地图上绘制矩形" }}
          </button>
        </div>

        <div class="divider">或 输入坐标</div>

        <!-- 4个坐标输入框 -->
        <div class="coords-grid">
          <div class="coord-item full-width">
            <label>北 (纬度)</label>
            <input
              type="number"
              step="0.000001"
              v-model.number="manualBounds.north"
              @input="onInputChanged"
            />
          </div>

          <div class="coord-item">
            <label>西 (经度)</label>
            <input
              type="number"
              step="0.000001"
              v-model.number="manualBounds.west"
              @input="onInputChanged"
            />
          </div>

          <div class="coord-item">
            <label>东 (经度)</label>
            <input
              type="number"
              step="0.000001"
              v-model.number="manualBounds.east"
              @input="onInputChanged"
            />
          </div>

          <div class="coord-item full-width">
            <label>南 (纬度)</label>
            <input
              type="number"
              step="0.000001"
              v-model.number="manualBounds.south"
              @input="onInputChanged"
            />
          </div>
        </div>

        <div class="panel-tip">* 更新输入框会更新地图上的矩形。</div>
      </div>
    </div>

    <!-- 预览模态框 -->
    <div v-if="showPreview" class="modal-overlay">
      <div class="modal-content">
        <div class="modal-header">
          <h3>{{ previewTitle }}</h3>
          <button @click="showPreview = false" class="close-btn">
            &times;
          </button>
        </div>
        <div id="preview-map" class="preview-body"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, reactive, nextTick, watch, computed } from "vue";
import axios from "axios";
import AMapLoader from "@amap/amap-jsapi-loader";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { io } from "socket.io-client"; 

// --- 状态定义 ---
const selectedPresetIndex = ref<string | number>(0);
const isDownloading = ref(false);
const showPreview = ref(false);
const previewTitle = ref("地图预览");
const logs = ref<{ time: string; msg: string }[]>([]);
const logContainer = ref<HTMLElement | null>(null);
const socket = io("http://localhost:8000"); 

// **新增：预览模式状态**
type PreviewMode = 'draft' | 'record';
const previewMode = ref<PreviewMode>('draft');
const currentPreviewRecord = ref<any>(null);

// 下载管理相关状态
const downloads = ref<any[]>([]);
const activeTab = ref<"download" | "manage">("download");
const selectedDownloads = ref<number[]>([]);

// 手动坐标输入 (North, South, East, West)
const manualBounds = reactive({
  north: null as number | null,
  south: null as number | null,
  east: null as number | null,
  west: null as number | null,
});

// 地图配置预设
const mapPresets = [
  { name: "ArcGIS World Imagery", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", needsKey: false },
  { name: "Google Maps (Satellite)", url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", needsKey: false },
  { name: "Google Maps (Standard)", url: "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", needsKey: false },
  { name: "TianDiTu (Vector)", needsKey: true, rawUrl: "https://t0.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={key}", url: "" },
];
const currentPreset = ref(mapPresets[0]);

const config = reactive({
  url: mapPresets[0].url,
  apiKey: "",
  minZoom: 14,
  maxZoom: 16,
  uploadToMinio: false,
  minio: {
    endPoint: "192.168.1.100",
    port: 9000,
    useSSL: false,
    accessKey: "minioadmin",
    secretKey: "minioadmin",
    bucket: "maps",
  },
});

const hasValidBounds = computed(() => {
  const { north, south, east, west } = manualBounds;
  return (
    typeof north === "number" &&
    typeof south === "number" &&
    typeof east === "number" &&
    typeof west === "number" &&
    north > south &&
    east > west
  );
});

// 地图实例
let aMap: any = null;
let mapInstance: any = null;
let mouseTool: any = null;
let currentRectangle: any = null;
const isDrawing = ref(false);
let previewMap: L.Map | null = null;

// --- 初始化 ---
onMounted(() => {
  initAMap();
  applyPreset();

  socket.on("connect", () => addLog("✅ 已连接到服务器"));
  socket.on("log", (msg: string) => addLog(msg));
  socket.on("job-finish", (data: any) => {
    isDownloading.value = false;
    addLog("-----------------------------------");
    if (data.status === "cancelled") {
      addLog(`🚫 任务已取消。`);
    } else {
      addLog(`🏁 完成！成功: ${data.success}, 错误: ${data.error}`);
      alert(`下载已完成！\n成功: ${data.success}`);
    }
  });
  socket.on("job-start", () => {
    isDownloading.value = true;
    logs.value = [];
    addLog("--- 新任务开始 ---");
  });
});

// --- 功能函数 ---

// 1. 预览“草稿” (当前设置)
function previewDraft() {
  previewMode.value = 'draft';
  previewTitle.value = "预览结果 (当前设置)";
  showPreview.value = true;
}

// 2. 预览“离线记录” (历史下载)
function previewRecord(download: any) {
  previewMode.value = 'record';
  currentPreviewRecord.value = download;
  previewTitle.value = `预览: ${download.name}`;
  showPreview.value = true;
}

// 监听预览窗口打开，渲染不同的地图
watch(showPreview, (val) => {
  if (val) {
    nextTick(() => {
      // 销毁旧地图
      if (previewMap) {
        previewMap.remove();
        previewMap = null;
      }

      // 准备渲染参数
      let bounds: L.LatLngBounds | null = null;
      let minZoom = 0;
      let maxZoom = 20;

      if (previewMode.value === 'record' && currentPreviewRecord.value) {
        // --- 渲染历史记录 ---
        const rec = currentPreviewRecord.value;
        bounds = L.latLngBounds(
          L.latLng(rec.south, rec.west),
          L.latLng(rec.north, rec.east)
        );
        minZoom = rec.minZoom;
        maxZoom = rec.maxZoom;
      } else {
        // --- 渲染当前草稿 ---
        if (hasValidBounds.value) {
          bounds = L.latLngBounds(
            L.latLng(manualBounds.south!, manualBounds.west!),
            L.latLng(manualBounds.north!, manualBounds.east!)
          );
          minZoom = config.minZoom;
          maxZoom = config.maxZoom;
        }
      }

      // 初始化地图
      if (bounds) {
        previewMap = L.map("preview-map");
        
        // 添加本地瓦片层
        // 注意：这里假设后端将所有下载混在一起放在根目录，或者是根据请求动态返回
        // 如果后端支持区分目录，URL 应该是 /tiles/{downloadId}/{z}/{x}/{y}.png
        // 基于当前提供的后端代码，暂用通用路径
        L.tileLayer("http://localhost:8000/tiles/{z}/{x}/{y}.png", {
          minZoom: minZoom,
          maxZoom: maxZoom,
          attribution: "Local Server",
          errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' // 空白图处理
        }).addTo(previewMap);

        previewMap.fitBounds(bounds);

        // 高亮区域框
        L.rectangle(bounds, {
          color: "#ff7800",
          weight: 2,
          fillOpacity: 0.05
        }).addTo(previewMap);
      } else {
        // 无效数据的默认视图
        previewMap = L.map("preview-map").setView([35, 105], 4);
        L.tileLayer("http://localhost:8000/tiles/{z}/{x}/{y}.png").addTo(previewMap);
      }
    });
  }
});


// --- 下面是常规业务逻辑 (保持不变) ---

async function fetchDownloads() {
  try {
    const response = await axios.get("http://localhost:8000/api/downloads");
    downloads.value = response.data;
  } catch (error) {
    addLog("❌ 获取下载列表失败");
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

async function deleteDownload(id: number) {
  if (!confirm("确定要删除这个下载记录吗？")) return;
  try {
    await axios.delete(`http://localhost:8000/api/downloads/${id}`);
    addLog("✅ 下载记录已删除");
    fetchDownloads();
  } catch (error) {
    addLog("❌ 删除下载记录失败");
  }
}

async function packageDownloads() {
  if (selectedDownloads.value.length === 0) return;
  try {
    const response = await axios.post(
      "http://localhost:8000/api/downloads/package",
      { ids: selectedDownloads.value },
      { responseType: "blob" }
    );
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `downloads_${new Date().getTime()}.zip`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    addLog("✅ 打包下载完成");
  } catch (error) {
    addLog("❌ 打包下载失败");
  }
}

function toggleSelection(id: number) {
  const index = selectedDownloads.value.indexOf(id);
  if (index > -1) selectedDownloads.value.splice(index, 1);
  else selectedDownloads.value.push(id);
}

function toggleSelectAll() {
  if (selectedDownloads.value.length === downloads.value.length) selectedDownloads.value = [];
  else selectedDownloads.value = downloads.value.map((d) => d.id);
}

async function startDownload() {
  if (!hasValidBounds.value) return;
  isDownloading.value = true;
  addLog("🚀 请求后端开始任务...");
  try {
    const res = await axios.post("http://localhost:8000/api/download", {
      url: config.url,
      bounds: manualBounds,
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
      uploadToMinio: config.uploadToMinio,
      minioConfig: config.minio,
    });
    addLog(`✅ 服务器已接受任务。总计瓦片数: ${res.data.totalTiles}`);
  } catch (e: any) {
    addLog(`❌ 请求失败: ${e.message}`);
    isDownloading.value = false;
  }
}

async function cancelDownload() {
  addLog("🛑 发送取消请求...");
  try {
    await axios.post("http://localhost:8000/api/cancel");
    isDownloading.value = false; 
    addLog("⏸️ 取消请求已发送...");
  } catch (e: any) {
    addLog(`❌ 取消失败: ${e.message}`);
  }
}

function applyPreset() {
  currentPreset.value = mapPresets[parseInt(selectedPresetIndex.value.toString())];
  if (currentPreset.value.needsKey) updateUrlWithKey();
  else config.url = currentPreset.value.url;
}

function updateUrlWithKey() {
  if (currentPreset.value.needsKey && (currentPreset.value as any).rawUrl) {
    config.url = (currentPreset.value as any).rawUrl.replace("{key}", config.apiKey);
  }
}

function addLog(msg: string) {
  const time = new Date().toLocaleTimeString();
  logs.value.push({ time, msg });
  nextTick(() => {
    if (logContainer.value) logContainer.value.scrollTop = logContainer.value.scrollHeight;
  });
}

function initAMap() {
  window._AMapSecurityConfig = { securityJsCode: "23c00ef6059cd80c4d258532eeab0fac" };
  AMapLoader.load({
    key: "5ceedd5be3ae4e4067808cea3b5d6b48",
    version: "2.0",
    plugins: ["AMap.MouseTool", "AMap.Rectangle"],
  }).then((AMap) => {
    aMap = AMap;
    mapInstance = new AMap.Map("amap-container", {
      zoom: 11,
      center: [108.9398, 34.3416],
      viewMode: "2D",
      mapStyle: "amap://styles/whitesmoke",
    });
    mouseTool = new AMap.MouseTool(mapInstance);
    mouseTool.on("draw", (event: any) => {
      const bounds = event.obj.getBounds();
      manualBounds.north = parseFloat(bounds.getNorthEast().getLat().toFixed(6));
      manualBounds.east = parseFloat(bounds.getNorthEast().getLng().toFixed(6));
      manualBounds.south = parseFloat(bounds.getSouthWest().getLat().toFixed(6));
      manualBounds.west = parseFloat(bounds.getSouthWest().getLng().toFixed(6));
      mapInstance.remove(event.obj);
      closeDrawMode();
      renderRectangleFromInputs();
      addLog("✅ 区域已绘制");
    });
  }).catch((e) => console.error(e));
}

function toggleDrawRect() {
  if (!mouseTool) return;
  if (isDrawing.value) closeDrawMode();
  else {
    isDrawing.value = true;
    if (currentRectangle) {
      mapInstance.remove(currentRectangle);
      currentRectangle = null;
    }
    mouseTool.rectangle({
      strokeColor: "#2563eb", strokeOpacity: 1, strokeWeight: 2,
      fillColor: "#3b82f6", fillOpacity: 0.3, strokeStyle: "solid",
    });
    mapInstance.setDefaultCursor("crosshair");
  }
}

function closeDrawMode() {
  isDrawing.value = false;
  mouseTool.close(false);
  mapInstance.setDefaultCursor("default");
}

function onInputChanged() {
  if (hasValidBounds.value) renderRectangleFromInputs();
}

function renderRectangleFromInputs() {
  if (!aMap || !mapInstance || !hasValidBounds.value) return;
  if (currentRectangle) mapInstance.remove(currentRectangle);
  const bounds = new aMap.Bounds(
    new aMap.LngLat(manualBounds.west, manualBounds.south),
    new aMap.LngLat(manualBounds.east, manualBounds.north),
  );
  currentRectangle = new aMap.Rectangle({
    bounds: bounds,
    strokeColor: "#10b981", strokeWeight: 2, strokeOpacity: 1,
    strokeDasharray: [10, 5], fillColor: "#10b981", fillOpacity: 0.2, zIndex: 50,
  });
  mapInstance.add(currentRectangle);
  mapInstance.setFitView([currentRectangle]);
}
</script>

<style scoped>
/* 样式保持不变 */
.app-container { display: flex; height: 100vh; width: 100vw; font-family: sans-serif; background-color: #f3f4f6; color: #1f2937; }
.sidebar { width: 380px; background: white; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; z-index: 10; }
.scroll-content { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.brand { padding: 20px; border-bottom: 1px solid #eee; }
.card { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
.card-header h3 { margin: 0; font-size: 14px; display: flex; align-items: center; gap: 8px; }
.form-item { margin-bottom: 10px; }
.form-item label { display: block; font-size: 12px; color: #666; margin-bottom: 4px; }
input, select { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
.sidebar-footer { padding: 16px; border-top: 1px solid #eee; background: white; }
.btn { width: 100%; padding: 10px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-bottom: 8px; }
.btn-primary { background: #2563eb; color: white; }
.btn-danger { background: #dc2626; color: white; }
.btn-danger:hover { background: #b91c1c; }
.btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
.btn-secondary { background: white; border: 1px solid #ccc; }
.log-viewer { height: 100px; background: #111; color: #0f0; font-family: monospace; font-size: 10px; padding: 8px; overflow-y: auto; }
.map-wrapper { flex: 1; position: relative; }
.map-view { width: 100%; height: 100%; }
.coords-panel { position: absolute; top: 20px; left: 20px; background: rgba(255, 255, 255, 0.95); padding: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15); z-index: 1000; width: 280px; backdrop-filter: blur(5px); border: 1px solid #e5e7eb; }
.coords-panel h4 { margin: 0 0 16px; font-size: 14px; color: #111827; border-bottom: 1px solid #eee; padding-bottom: 8px; }
.tool-bar { margin-bottom: 15px; }
.btn-tool { width: 100%; padding: 10px; background: #f3f4f6; border: 1px dashed #9ca3af; border-radius: 6px; color: #374151; cursor: pointer; transition: all 0.2s; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px; }
.btn-tool:hover { background: #e5e7eb; border-color: #6b7280; }
.btn-tool.active { background: #eff6ff; border-color: #2563eb; color: #2563eb; border-style: solid; font-weight: 600; }
.divider { text-align: center; font-size: 10px; color: #9ca3af; margin: 10px 0; font-weight: bold; letter-spacing: 1px; }
.coords-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.full-width { grid-column: span 2; }
.coord-item label { display: block; font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 4px; }
.coord-item input { font-family: "Monaco", monospace; font-size: 12px; color: #111827; background: #f9fafb; }
.coord-item input:focus { background: white; border-color: #2563eb; }
.panel-tip { margin-top: 12px; font-size: 10px; color: #6b7280; font-style: italic; }
.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); z-index: 2000; display: flex; justify-content: center; align-items: center; }
.modal-content { width: 80%; height: 80%; background: white; display: flex; flex-direction: column; border-radius: 8px; }
.modal-header { padding: 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; }
.preview-body { flex: 1; }
.zoom-inputs { display: flex; gap: 8px; align-items: center; }
.info-box { margin-top: 10px; padding: 10px; background: #f9fafb; border: 1px dashed #ddd; border-radius: 4px; font-size: 12px; }
.info-box.active { background: #ecfdf5; border-color: #10b981; color: #065f46; }
.minio-grid { display: grid; gap: 8px; }
.minio-grid .form-item label.switch { display: flex; align-items: center; gap: 8px; margin-bottom: 0; }
.minio-grid .form-item label.switch input[type="checkbox"] { margin-right: 4px; }
.downloads-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.downloads-header h3 { margin: 0; }
.btn-refresh { background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 4px; padding: 4px 8px; cursor: pointer; }
.btn-refresh:hover { background: #e5e7eb; }
.downloads-list { max-height: 400px; overflow-y: auto; }
.empty-state { text-align: center; padding: 32px; color: #6b7280; }
.download-item { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; margin-bottom: 12px; background: #f9fafb; }
.download-item:last-child { margin-bottom: 0; }
.download-name { font-weight: 600; margin-bottom: 8px; color: #1f2937; }
.download-meta { display: flex; gap: 12px; margin-bottom: 8px; font-size: 12px; color: #6b7280; }
.download-bounds { font-size: 11px; color: #6b7280; margin-bottom: 8px; }
.download-time { font-size: 11px; color: #9ca3af; }
.download-actions { display: flex; gap: 8px; margin-top: 8px; }
.btn-action { padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; background: white; font-size: 12px; cursor: pointer; }
.btn-action:hover { background: #f3f4f6; }
.btn-action.danger:hover { background: #fee2e2; color: #dc2626; }
.nav-tabs { display: flex; border-bottom: 1px solid #e5e7eb; }
.tab-button { flex: 1; padding: 12px; background: transparent; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-weight: 500; color: #6b7280; transition: all 0.2s; }
.tab-button:hover { background: #f9fafb; color: #374151; }
.tab-button.active { color: #2563eb; border-bottom-color: #2563eb; }
.bulk-actions { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e5e7eb; margin-bottom: 16px; }
.checkbox-inline { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #374151; }
.checkbox-inline input { width: 16px; height: 16px; }
.download-item { display: flex; gap: 12px; }
.download-select { display: flex; align-items: center; }
.download-select input { width: 16px; height: 16px; }
</style>