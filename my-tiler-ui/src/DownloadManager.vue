<template>
  <div class="app-container">
    <!-- 左侧：控制面板 -->
    <div class="sidebar">
      <div class="brand">
        <h1>🗺️ 地图瓦片下载器</h1>
        <p>瓦片下载与管理</p>
      </div>

      <div class="scroll-content">
        <!-- 1. 地图源设置 -->
        <section class="card" v-if="selectedPresetIndex !== 'downloads'">
          <div class="card-header">
            <span class="icon">📡</span>
            <h3>地图源</h3>
          </div>
          <div class="form-item">
            <label>预设</label>
            <select v-model="selectedPresetIndex" @change="applyPreset">
              <option v-for="(preset, index) in mapPresets" :key="index" :value="index.toString()">
                {{ preset.name }}
              </option>
              <option value="downloads">📥 下载管理</option>
            </select>
          </div>

          <div v-else>
            <div class="form-item">
              <label>URL 模板</label>
              <input v-model="config.url" type="text" class="code-input" />
            </div>

            <div v-if="currentPreset.needsKey" class="form-item">
              <label>API 密钥</label>
              <input v-model="config.apiKey" type="text" @input="updateUrlWithKey" />
            </div>
          </div>
        </section>

                </section>

