
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { google } from "googleapis";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export class DriveCloud {
  constructor({ dataDir, clientId, clientSecret, redirectUri, encryptionKey }) {
    this.dataDir = dataDir;
    this.clientId = clientId || "";
    this.clientSecret = clientSecret || "";
    this.redirectUri = redirectUri || "";
    this.encryptionKey = encryptionKey || "";
    this.tokenPath = path.join(dataDir, "google-drive.tokens.enc");
    this.metaPath = path.join(dataDir, "google-drive.meta.json");
    this.scope = "https://www.googleapis.com/auth/drive.file";
  }

  configured() {
    return !!(this.clientId && this.clientSecret && this.redirectUri);
  }

  oauth() {
    return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
  }

  key() {
    if (!this.encryptionKey) return null;
    return crypto.createHash("sha256").update(this.encryptionKey).digest();
  }

  async saveTokens(tokens) {
    const key = this.key();
    if (!key) throw new Error("Falta CEREBRO_TOKENS_KEY para guardar Drive de forma segura.");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(tokens),"utf8")), cipher.final()]);
    const out = {v:1,iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:enc.toString("base64")};
    await fsp.writeFile(this.tokenPath+".tmp", JSON.stringify(out), "utf8");
    await fsp.rename(this.tokenPath+".tmp", this.tokenPath);
  }

  async loadTokens() {
    const key = this.key();
    if (!key) return null;
    try {
      const obj = JSON.parse(await fsp.readFile(this.tokenPath,"utf8"));
      const dec = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(obj.iv,"base64"));
      dec.setAuthTag(Buffer.from(obj.tag,"base64"));
      const plain = Buffer.concat([dec.update(Buffer.from(obj.data,"base64")), dec.final()]);
      return JSON.parse(plain.toString("utf8"));
    } catch {
      return null;
    }
  }

  async disconnect() {
    await fsp.rm(this.tokenPath,{force:true});
    await fsp.rm(this.metaPath,{force:true});
  }

  authUrl(state) {
    const client = this.oauth();
    return client.generateAuthUrl({
      access_type:"offline",
      prompt:"consent",
      include_granted_scopes:true,
      scope:[this.scope],
      state
    });
  }

  async exchange(code) {
    const client = this.oauth();
    const {tokens} = await client.getToken(code);
    if (!tokens.refresh_token) {
      const old = await this.loadTokens();
      if (old?.refresh_token) tokens.refresh_token = old.refresh_token;
    }
    await this.saveTokens(tokens);
    return tokens;
  }

  async client() {
    const tokens = await this.loadTokens();
    if (!tokens) throw new Error("Google Drive no está conectado.");
    const client = this.oauth();
    client.setCredentials(tokens);
    client.on("tokens", async fresh => {
      const current = await this.loadTokens() || {};
      await this.saveTokens({...current,...fresh});
    });
    return client;
  }

  async drive() {
    return google.drive({version:"v3",auth:await this.client()});
  }

  async meta() {
    try { return JSON.parse(await fsp.readFile(this.metaPath,"utf8")); } catch { return {}; }
  }

  async saveMeta(meta) {
    await fsp.writeFile(this.metaPath+".tmp",JSON.stringify(meta,null,2),"utf8");
    await fsp.rename(this.metaPath+".tmp",this.metaPath);
  }

  async ensureRoot() {
    const drive = await this.drive();
    let meta = await this.meta();
    if (meta.rootId) {
      try {
        const chk = await drive.files.get({fileId:meta.rootId,fields:"id,name,trashed"});
        if (!chk.data.trashed) return meta.rootId;
      } catch {}
    }
    const q = `name='CEREBRO' and mimeType='${FOLDER_MIME}' and trashed=false`;
    const found = await drive.files.list({q,spaces:"drive",fields:"files(id,name)",pageSize:10});
    let rootId = found.data.files?.[0]?.id;
    if (!rootId) {
      const created = await drive.files.create({
        requestBody:{name:"CEREBRO",mimeType:FOLDER_MIME},
        fields:"id"
      });
      rootId = created.data.id;
    }
    meta = {...meta,rootId,connectedAt:meta.connectedAt||new Date().toISOString()};
    await this.saveMeta(meta);
    return rootId;
  }

  async status() {
    if (!this.configured()) return {configured:false,connected:false};
    const tokens = await this.loadTokens();
    if (!tokens) return {configured:true,connected:false};
    try {
      const drive = await this.drive();
      const about = await drive.about.get({fields:"user(displayName,emailAddress),storageQuota(limit,usage,usageInDrive)"});
      const rootId = await this.ensureRoot();
      return {configured:true,connected:true,rootId,user:about.data.user,storageQuota:about.data.storageQuota};
    } catch (e) {
      return {configured:true,connected:false,error:e.message};
    }
  }

  async list(parentId) {
    const drive = await this.drive();
    const pid = parentId || await this.ensureRoot();
    const q = `'${pid}' in parents and trashed=false`;
    const r = await drive.files.list({
      q,spaces:"drive",
      fields:"files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,parents)",
      orderBy:"folder,name_natural",pageSize:1000
    });
    return {parentId:pid,items:r.data.files||[]};
  }

  async createFolder(name,parentId) {
    const drive = await this.drive();
    const pid = parentId || await this.ensureRoot();
    const r = await drive.files.create({
      requestBody:{name,mimeType:FOLDER_MIME,parents:[pid]},
      fields:"id,name,mimeType,parents"
    });
    return r.data;
  }

  async upload(localPath,name,parentId,mimeType) {
    const drive = await this.drive();
    const pid = parentId || await this.ensureRoot();
    const r = await drive.files.create({
      requestBody:{name,parents:[pid]},
      media:{mimeType:mimeType||"application/octet-stream",body:fs.createReadStream(localPath)},
      fields:"id,name,mimeType,size,modifiedTime,parents"
    });
    return r.data;
  }

  async rename(fileId,name) {
    const drive=await this.drive();
    const r=await drive.files.update({fileId,requestBody:{name},fields:"id,name,mimeType,parents"});
    return r.data;
  }

  async move(fileId,newParentId) {
    const drive=await this.drive();
    const current=await drive.files.get({fileId,fields:"parents"});
    const oldParents=(current.data.parents||[]).join(",");
    const r=await drive.files.update({
      fileId,addParents:newParentId,removeParents:oldParents,
      fields:"id,name,mimeType,parents"
    });
    return r.data;
  }

  async trash(fileId) {
    const drive=await this.drive();
    const r=await drive.files.update({fileId,requestBody:{trashed:true},fields:"id,name,trashed"});
    return r.data;
  }

  async search(text) {
    const drive=await this.drive();
    const rootId=await this.ensureRoot();
    const escaped=String(text).replaceAll("\\","\\\\").replaceAll("'","\\'");
    const q=`name contains '${escaped}' and trashed=false`;
    const r=await drive.files.list({
      q,spaces:"drive",
      fields:"files(id,name,mimeType,size,modifiedTime,parents,webViewLink)",
      pageSize:100
    });
    // With drive.file scope only app-created/selected files are visible.
    return (r.data.files||[]);
  }

  async download(fileId) {
    const drive=await this.drive();
    const meta=await drive.files.get({fileId,fields:"id,name,mimeType,size"});
    if (String(meta.data.mimeType||"").startsWith("application/vnd.google-apps.")) {
      throw new Error("Este elemento nativo de Google debe abrirse en Drive; CEREBRO no lo exporta todavía.");
    }
    const r=await drive.files.get({fileId,alt:"media"},{responseType:"stream"});
    return {meta:meta.data,stream:r.data};
  }
}
