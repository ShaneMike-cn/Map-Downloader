// 修正 1: 使用 'import type' 明确导入类型，避免编译混淆
import express, { type Request, type Response } from 'express';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import pLimit from 'p-limit';
import { fileURLToPath } from 'url';

// 修正 ESM 模式下 __dirname 不可用的问题
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// --- 核心数学逻辑 ---
interface TileCoord {
  x: number;
  y: number;
  z: number;
}

interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

function long2tile(lon: number, zoom: number): number {
  return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom)));
}

function lat2tile(lat: number, zoom: number): number {
  return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)));
}

function calculateTiles(bounds: Bounds, minZoom: number, maxZoom: number): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const xMin = long2tile(bounds.west, z);
    const xMax = long2tile(bounds.east, z);
    const yMin = lat2tile(bounds.north, z);
    const yMax = lat2tile(bounds.south, z);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ x, y, z });
      }
    }
  }
  return tiles;
}

// --- 下载逻辑 ---

interface DownloadRequest {
  url: string;
  bounds: Bounds;
  minZoom: number;
  maxZoom: number;
  outputDir?: string;
  concurrency?: number;
}

app.post('/api/download', async (req: Request, res: Response): Promise<any> => {
  const { url, bounds, minZoom, maxZoom, outputDir = './output', concurrency = 5 } = req.body as DownloadRequest;

  if (!url || !bounds || minZoom === undefined || maxZoom === undefined) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  console.log(`[Calc] Calculating tiles for Zoom ${minZoom}-${maxZoom}...`);
  const tiles = calculateTiles(bounds, minZoom, maxZoom);
  const total = tiles.length;

  if (total === 0) {
    return res.status(200).json({ message: 'No tiles found in this range.' });
  }

  console.log(`[Job] Found ${total} tiles. Starting download with concurrency ${concurrency}...`);

  res.json({
    status: 'started',
    totalTiles: total,
    message: `Started downloading ${total} tiles.`
  });

  const limit = pLimit(concurrency);
  let downloadedCount = 0;
  let failedCount = 0;

  const downloadTask = tiles.map((tile) => {
    return limit(async () => {
      let tileUrl = url
        .replace('{x}', tile.x.toString())
        .replace('{y}', tile.y.toString())
        .replace('{z}', tile.z.toString());
      
      if (tileUrl.includes('{s}')) {
        const subdomains = ['a', 'b', 'c'];
        // 修正 2: 增加 || 'a' 兜底，防止 TS 报错说可能是 undefined
        const s = subdomains[(tile.x + tile.y) % subdomains.length] || 'a';
        tileUrl = tileUrl.replace('{s}', s);
      }

      const ext = path.extname(tileUrl) || '.png';
      const dirPath = path.join(outputDir, tile.z.toString(), tile.x.toString());
      const filePath = path.join(dirPath, `${tile.y}${ext}`);

      if (await fs.pathExists(filePath)) {
        downloadedCount++;
        return;
      }

      try {
        const response = await axios.get(tileUrl, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          timeout: 10000 
        });

        await fs.ensureDir(dirPath);
        await fs.writeFile(filePath, response.data);
        downloadedCount++;
        
        if (downloadedCount % 100 === 0) {
          console.log(`[Progress] ${downloadedCount}/${total} (${((downloadedCount/total)*100).toFixed(1)}%)`);
        }
      } catch (error) {
        failedCount++;
        // 这里的 error as Error 用于修复 TS 在 catch 块中类型未知的警告
        console.error(`[Error] Failed ${tile.z}/${tile.x}/${tile.y}: ${(error as Error).message}`);
      }
    });
  });

  Promise.all(downloadTask).then(() => {
    console.log(`[Done] Download finished. Success: ${downloadedCount}, Failed: ${failedCount}`);
  });
});

const PORT = 6000;
app.listen(PORT, () => {
  console.log(`Tiler API Server running on http://localhost:${PORT}`);
});