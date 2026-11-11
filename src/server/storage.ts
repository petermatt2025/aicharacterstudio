import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { env } from "./env";

/** Private object storage. Objects are never public; every read goes through an authorized server route. */
export interface StorageAdapter {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,250}$/;
function assertKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..")) throw new Error("Invalid storage key");
}

class LocalStorage implements StorageAdapter {
  constructor(private root: string) {}
  private file(key: string) {
    assertKey(key);
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, bytes: Buffer) {
    const p = this.file(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, bytes, { mode: 0o600 });
  }
  async get(key: string) {
    return fs.readFile(this.file(key));
  }
  async delete(key: string) {
    await fs.unlink(this.file(key)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}

class S3Storage implements StorageAdapter {
  private client: S3Client;
  constructor(private bucket: string) {
    const e = env();
    this.client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY } : undefined,
    });
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    assertKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType, ServerSideEncryption: env().S3_ENDPOINT ? undefined : "AES256" }));
  }
  async get(key: string) {
    assertKey(key);
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(key: string) {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let instance: StorageAdapter | null = null;
export function storage(): StorageAdapter {
  if (instance) return instance;
  const e = env();
  if (e.STORAGE_DRIVER === "s3") {
    if (!e.S3_BUCKET) throw new Error("S3_BUCKET is required for STORAGE_DRIVER=s3");
    instance = new S3Storage(e.S3_BUCKET);
  } else {
    instance = new LocalStorage(path.resolve(process.cwd(), e.STORAGE_LOCAL_DIR));
  }
  return instance;
}
export function setStorageForTests(s: StorageAdapter | null) {
  instance = s;
}
