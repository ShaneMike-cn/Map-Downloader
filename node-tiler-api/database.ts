import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

// 获取当前目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 确保数据库目录存在
const dbDir = path.join(__dirname, 'db');
fs.ensureDirSync(dbDir);

// 数据库文件路径
const dbPath = path.join(dbDir, 'downloads.db');

// 下载记录类型定义
export interface DownloadRecord {
  id?: number;
  name: string;
  downloadTime?: string;
  minZoom: number;
  maxZoom: number;
  north: number;
  south: number;
  east: number;
  west: number;
  filePath: string;
  fileSize: number;
  tileCount: number;
}

let db: Database | null = null;

// 初始化数据库
export async function initializeDatabase() {
  if (db) return db;

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // 创建下载记录表
  await db.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      download_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      min_zoom INTEGER,
      max_zoom INTEGER,
      north REAL,
      south REAL,
      east REAL,
      west REAL,
      file_path TEXT,
      file_size INTEGER,
      tile_count INTEGER
    )
  `);

  return db;
}

// 添加下载记录
export async function addDownloadRecord(record: Omit<DownloadRecord, 'id' | 'downloadTime'>): Promise<number> {
  if (!db) await initializeDatabase();

  const result = await db!.run(
    `INSERT INTO downloads
     (name, min_zoom, max_zoom, north, south, east, west, file_path, file_size, tile_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.name,
      record.minZoom,
      record.maxZoom,
      record.north,
      record.south,
      record.east,
      record.west,
      record.filePath,
      record.fileSize,
      record.tileCount
    ]
  );

  return result.lastID;
}

// 获取所有下载记录
export async function getAllDownloads(): Promise<DownloadRecord[]> {
  if (!db) await initializeDatabase();

  const records = await db!.all(`
    SELECT
      id,
      name,
      download_time as downloadTime,
      min_zoom as minZoom,
      max_zoom as maxZoom,
      north,
      south,
      east,
      west,
      file_path as filePath,
      file_size as fileSize,
      tile_count as tileCount
    FROM downloads
    ORDER BY download_time DESC
  `);

  return records;
}

// 根据ID获取下载记录
export async function getDownloadById(id: number): Promise<DownloadRecord | undefined> {
  if (!db) await initializeDatabase();

  const record = await db!.get(`
    SELECT
      id,
      name,
      download_time as downloadTime,
      min_zoom as minZoom,
      max_zoom as maxZoom,
      north,
      south,
      east,
      west,
      file_path as filePath,
      file_size as fileSize,
      tile_count as tileCount
    FROM downloads
    WHERE id = ?
  `, [id]);

  return record;
}

// 删除下载记录
export async function deleteDownload(id: number): Promise<boolean> {
  if (!db) await initializeDatabase();

  const result = await db!.run('DELETE FROM downloads WHERE id = ?', [id]);
  return result.changes > 0;
}

// 更新下载记录
export async function updateDownload(id: number, updates: Partial<DownloadRecord>): Promise<boolean> {
  if (!db) await initializeDatabase();

  const fields: string[] = [];
  const values: any[] = [];

  Object.entries(updates).forEach(([key, value]) => {
    // 转换字段名为数据库字段名
    const dbField = key
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase();

    if (dbField !== 'id') {
      fields.push(`${dbField} = ?`);
      values.push(value);
    }
  });

  if (fields.length === 0) return false;

  values.push(id);

  const result = await db!.run(
    `UPDATE downloads SET ${fields.join(', ')} WHERE id = ?`,
    values
  );

  return result.changes > 0;
}