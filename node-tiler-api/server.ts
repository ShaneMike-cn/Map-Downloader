// backend.ts (或者 server.ts)

import express, { type Request, type Response } from 'express';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import pLimit from 'p-limit';
import * as Minio from 'minio';
import cors from 'cors';
import { fileURLToPath } from 'url';
import http from 'http';
import { Server } from 'socket.io';
import { initializeDatabase, addDownloadRecord, getAllDownloads, deleteDownload, getDownloadById } from './database.ts';
import { createReadStream, statSync } from 'fs';
import { pipeline } from 'stream/promises';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 初始化数据库
initializeDatabase().then(() => {
  console.log('数据库初始化成功');
}).catch(err => {
  console.error('数据库初始化失败:', err);
});

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.json());
app.use(cors());
app.use('/tiles', express.static(path.join(__dirname, 'output')));

// --- 全局任务状态控制 ---
// 在真实生产环境中，应该使用 Map<JobId, State> 来支持多用户，这里简单起见用全局变量
let currentJob = {
  isRunning: false,
  isCancelled: false
};

// --- 工具函数 & 类型定义 (保持不变) ---
interface Bounds { north: number; south: number; east: number; west: number; }
interface MinioConfig { endPoint: string; port: number; useSSL: boolean; accessKey: string; secretKey: string; bucket: string; }
interface DownloadRequest { url: string; bounds: Bounds; minZoom: number; maxZoom: number; outputDir?: string; concurrency?: number; uploadToMinio?: boolean; minioConfig?: MinioConfig; }

function long2tile(lon: number, zoom: number): number { return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom))); }
function lat2tile(lat: number, zoom: number): number { return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }

io.on('connection', (socket) => { console.log('[Socket] 已连接:', socket.id); });

// --- 新增：取消接口 ---
app.post('/api/cancel', (req, res) => {
  if (currentJob.isRunning) {
    currentJob.isCancelled = true;
    io.emit('log', '🛑 用户请求取消...');
    return res.json({ status: 'cancelling' });
  }
  res.json({ status: 'no_running_job' });
});

// --- 下载接口 ---
app.post('/api/download', async (req: Request, res: Response): Promise<any> => {
  // 1. 检查是否有任务正在运行
  if (currentJob.isRunning) {
    return res.status(409).json({ error: 'A job is already running' });
  }

  const { url, bounds, minZoom, maxZoom, outputDir = 'output', concurrency = 10, uploadToMinio, minioConfig } = req.body as DownloadRequest;
  if (!url || !bounds) return res.status(400).json({ error: '缺少参数' });

  // 保存outputDir到变量，以便在后续步骤中使用
  const outputDirParam = outputDir;

  // 2. 重置任务状态
  currentJob.isRunning = true;
  currentJob.isCancelled = false;

  // MinIO 初始化 (保持不变)
  let minioClient: Minio.Client | null = null;
  if (uploadToMinio && minioConfig) {
    try {
      minioClient = new Minio.Client({
        endPoint: minioConfig.endPoint,
        port: Number(minioConfig.port),
        useSSL: minioConfig.useSSL,
        accessKey: minioConfig.accessKey,
        secretKey: minioConfig.secretKey,
      });
      const exists = await minioClient.bucketExists(minioConfig.bucket);
      if (!exists) await minioClient.makeBucket(minioConfig.bucket, 'us-east-1');
    } catch (e) {
      currentJob.isRunning = false; // 失败重置
      io.emit('log', `❌ MinIO 配置错误: ${(e as Error).message}`);
      return res.status(500).json({ error: 'MinIO 初始化失败' });
    }
  }

  // 计算瓦片
  const tiles: any[] = [];
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

  res.json({ status: 'started', totalTiles: tiles.length });
  io.emit('job-start', { total: tiles.length });
  io.emit('log', `🚀 任务开始！瓦片总数: ${tiles.length}`);

  const limit = pLimit(concurrency);
  const baseOutputDir = path.join(__dirname, outputDir);
  let completedCount = 0;
  let errorCount = 0;

  const tasks = tiles.map(tile => {
    return limit(async () => {
      // --- 关键点：检查是否已取消 ---
      if (currentJob.isCancelled) {
        return; // 直接跳过，不执行任何操作
      }

      let tileUrl = url.replace('{x}', tile.x).replace('{y}', tile.y).replace('{z}', tile.z);
      if (tileUrl.includes('{s}')) {
        const subdomains = ['a', 'b', 'c'];
        tileUrl = tileUrl.replace('{s}', subdomains[(tile.x + tile.y) % 3]);
      }

      const ext = path.extname(tileUrl.split('?')[0]) || '.png';
      const relativePath = `${tile.z}/${tile.x}/${tile.y}${ext}`;
      const filePath = path.join(baseOutputDir, relativePath);

      try {
        let statusMsg = '';
        // 模拟下载检查
        if (!(await fs.pathExists(filePath))) {
          const response = await axios.get(tileUrl, {
            responseType: 'arraybuffer',
            headers: { 'User-Agent': 'Mozilla/5.0...' },
            timeout: 10000
          });
          await fs.ensureDir(path.dirname(filePath));
          await fs.writeFile(filePath, response.data);
          statusMsg = '已下载';
        } else {
          statusMsg = '已存在';
        }

        if (minioClient && minioConfig) {
          const metaData = { 'Content-Type': 'image/png' };
          await minioClient.fPutObject(minioConfig.bucket, relativePath, filePath, metaData);
          statusMsg += ' & 已上传';
        }

        completedCount++;
        io.emit('log', `[${completedCount}/${tiles.length}] ${tile.z}/${tile.x}/${tile.y} - ${statusMsg}`);

      } catch (e) {
        errorCount++;
        const errMsg = (e as Error).message;
        io.emit('log', `❌ 错误 ${tile.z}/${tile.x}/${tile.y}: ${errMsg}`);

        // --- 关键点：错误时自动取消 ---
        // 这里可以加判断，例如如果是 404 可能不取消，但如果是网络断了或磁盘满了就取消
        // 如果你想 "一出错就自动停止"，则保留下面这段：
        /*
        if (!currentJob.isCancelled) {
             currentJob.isCancelled = true;
             io.emit('log', '🛑 发现严重错误。自动取消任务...');
             io.emit('job-cancelled', { reason: '由于错误自动取消' });
        }
        */

       // 或者：累计错误超过 5 个自动取消
       if (errorCount > 5 && !currentJob.isCancelled) {
          currentJob.isCancelled = true;
          io.emit('log', '🛑 错误过多(>5)。自动取消任务...');
       }
      }
    });
  });

  Promise.all(tasks).then(async () => {
    currentJob.isRunning = false; // 任务结束
    if (currentJob.isCancelled) {
      console.log('任务已取消');
      io.emit('log', `🚫 任务被用户或错误取消。`);
      io.emit('job-finish', { success: completedCount, error: errorCount, status: 'cancelled' });
    } else {
      console.log('任务完成');
      io.emit('log', `🎉 任务完成！成功: ${completedCount}, 错误: ${errorCount}`);
      io.emit('job-finish', { success: completedCount, error: errorCount, status: 'completed' });

      // 保存下载记录到数据库
      try {
        // 生成下载任务名称
        const name = `地图下载_${new Date().toISOString().slice(0, 10)}_${minZoom}-${maxZoom}`;

        // 计算文件大小
        const outputDirPath = path.join(__dirname, outputDirParam || 'output');
        let fileSize = 0;
        try {
          // 递归计算目录大小
          const calculateDirSize = async (dir: string): Promise<number> => {
            const files = await fs.readdir(dir);
            let size = 0;
            for (const file of files) {
              const filePath = path.join(dir, file);
              const stats = await fs.stat(filePath);
              if (stats.isDirectory()) {
                size += await calculateDirSize(filePath);
              } else {
                size += stats.size;
              }
            }
            return size;
          };

          fileSize = await calculateDirSize(outputDirPath);
        } catch (err) {
          console.error('计算文件大小时出错:', err);
        }

        // 添加到数据库
        const recordId = await addDownloadRecord({
          name,
          minZoom,
          maxZoom,
          north: bounds.north,
          south: bounds.south,
          east: bounds.east,
          west: bounds.west,
          filePath: outputDirPath,
          fileSize,
          tileCount: tiles.length
        });

        console.log(`下载记录已保存，ID: ${recordId}`);
        io.emit('log', `💾 下载记录已保存`);
      } catch (err) {
        console.error('保存下载记录时出错:', err);
        io.emit('log', `❌ 保存下载记录失败: ${(err as Error).message}`);
      }
    }
  });
});

// --- 新增：获取下载列表 ---
app.get('/api/downloads', async (req: Request, res: Response) => {
  try {
    const downloads = await getAllDownloads();
    res.json(downloads);
  } catch (err) {
    console.error('获取下载列表时出错:', err);
    res.status(500).json({ error: '获取下载列表失败' });
  }
});

// --- 新增：删除下载记录 ---
app.delete('/api/downloads/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的ID' });
    }

    // 先获取记录以获取文件路径
    const record = await getDownloadById(id);
    if (!record) {
      return res.status(404).json({ error: '未找到指定的下载记录' });
    }

    // 从数据库删除记录
    const success = await deleteDownload(id);
    if (success) {
      // 尝试删除文件（可选）
      try {
        // 注意：这里我们只删除记录，不实际删除文件，以防止误删
        // 如果需要删除文件，可以取消注释下面的代码
        // await fs.remove(record.filePath);
        console.log(`下载记录 ${id} 已删除`);
      } catch (err) {
        console.error(`删除文件时出错:`, err);
      }

      res.json({ success: true });
    } else {
      res.status(404).json({ error: '未找到指定的下载记录' });
    }
  } catch (err) {
    console.error('删除下载记录时出错:', err);
    res.status(500).json({ error: '删除下载记录失败' });
  }
});

// --- 新增：打包下载 ---
app.post('/api/downloads/package', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请选择至少一个下载项' });
    }

    // 创建临时ZIP文件
    const timestamp = new Date().getTime();
    const zipFilename = `downloads_${timestamp}.zip`;
    const zipPath = path.join(__dirname, 'temp', zipFilename);

    // 确保临时目录存在
    await fs.ensureDir(path.join(__dirname, 'temp'));

    // 创建可写流
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // 最高压缩级别
    });

    // 监听错误
    archive.on('error', (err) => {
      throw err;
    });

    // 管道归档到文件
    archive.pipe(output);

    // 添加选定的下载项到ZIP
    for (const id of ids) {
      const record = await getDownloadById(id);
      if (record && record.filePath) {
        // 检查目录是否存在
        if (await fs.pathExists(record.filePath)) {
          // 添加目录到ZIP
          archive.directory(record.filePath, record.name);
        }
      }
    }

    // 完成归档
    await archive.finalize();

    // 等待写入完成
    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
    });

    // 发送ZIP文件
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.setHeader('Content-Type', 'application/zip');

    const fileStream = createReadStream(zipPath);
    fileStream.pipe(res);

    // 文件发送完成后删除临时文件
    fileStream.on('close', async () => {
      try {
        await fs.remove(zipPath);
      } catch (err) {
        console.error('删除临时ZIP文件时出错:', err);
      }
    });
  } catch (err) {
    console.error('打包下载时出错:', err);
    res.status(500).json({ error: '打包下载失败' });
  }
});

httpServer.listen(8000, () => console.log('后端服务运行在 http://localhost:8000'));