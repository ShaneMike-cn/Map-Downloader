# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Vue 3 application built with Vite that serves as a map tile downloader UI. The application allows users to:
- Select map sources (Google Maps, TianDiTu, ArcGIS, etc.)
- Define geographic regions using Chinese administrative divisions
- Configure zoom levels for tile downloading
- Set up MinIO storage for tile uploads
- Preview downloaded tiles

## Key Technologies

- Vue 3 with Composition API (`<script setup>`)
- Vite build tool
- TypeScript (used in App.vue but no .ts files)
- Leaflet for map preview
- AMap (Gaode Map) API for region selection
- Element Plus UI components
- Axios for HTTP requests

## Project Structure

```
my-tiler-ui/
├── src/
│   ├── main.js          # Entry point
│   └── App.vue          # Main application component
├── public/              # Static assets
├── package.json         # Dependencies and scripts
└── vite.config.js       # Vite configuration
```

## Development Commands

### Install Dependencies
```bash
npm install
```

### Start Development Server
```bash
npm run dev
```
Default URL: http://localhost:5173

### Build for Production
```bash
npm run build
```
Outputs to `dist/` directory

### Preview Production Build
```bash
npm run preview
```

## Architecture Overview

The application is a single-page application centered around `App.vue`, which contains:

1. **Configuration Panel** (Left sidebar):
   - Map source selection with presets
   - Zoom level configuration (min/max)
   - MinIO storage settings with toggle

2. **Map Interface** (Right panel):
   - AMap integration for region selection
   - Cascading selectors for Chinese provinces/cities/districts
   - Visual boundary drawing on map

3. **Core Functionality**:
   - Region selection via administrative boundaries
   - Tile download job initiation via POST to `/api/download`
   - Local tile preview using Leaflet

## Important Implementation Details

- The app uses Gaode Map (AMap) API for Chinese administrative boundary data
- Map presets include Google Maps, TianDiTu, ArcGIS, and CartoDB
- TianDiTu requires an API key that gets injected into the URL template
- Downloads are initiated by POST requests to a backend service on port 3000
- Preview functionality loads tiles from a local static server endpoint
- MinIO configuration allows for direct cloud storage uploads

## Key Dependencies

- `vue`: Frontend framework
- `vite`: Build tool and development server
- `@amap/amap-jsapi-loader`: AMap API loader
- `leaflet`: Map rendering for preview
- `axios`: HTTP client
- `element-plus`: UI component library

## Backend Integration

The frontend communicates with a backend service:
- POST `/api/download` to initiate tile downloads
- GET `/tiles/{z}/{x}/{y}.png` for local tile preview

Note: The backend service is expected to run on `localhost:3000`.