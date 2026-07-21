import { open } from "node:fs/promises";
import { inflate } from "node:zlib";
import { promisify } from "node:util";
import Pbf from "pbf";

const inflateAsync = promisify(inflate);
const decoder = new TextDecoder();

export type OsmPbfNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags: Record<string, string>;
};

export type OsmPbfWay = {
  type: "way";
  id: number;
  refs: number[];
  tags: Record<string, string>;
};

export type OsmPbfRelation = {
  type: "relation";
  id: number;
  members: Array<{ type: "node" | "way" | "relation"; ref: number; role: string }>;
  tags: Record<string, string>;
};

export type OsmPbfEntity = OsmPbfNode | OsmPbfWay | OsmPbfRelation;

type BlobHeader = { type: string; dataSize: number };
type Blob = { raw?: Uint8Array; zlib?: Uint8Array };
type PrimitiveBlock = {
  strings: string[];
  groups: Uint8Array[];
  granularity: number;
  latOffset: number;
  lonOffset: number;
};

function readBlobHeaderField(tag: number, result: BlobHeader, pbf: Pbf) {
  if (tag === 1) result.type = pbf.readString();
  else if (tag === 3) result.dataSize = pbf.readVarint();
}

function readBlobField(tag: number, result: Blob, pbf: Pbf) {
  if (tag === 1) result.raw = pbf.readBytes();
  else if (tag === 3) result.zlib = pbf.readBytes();
}

function readStringTableField(tag: number, strings: string[], pbf: Pbf) {
  if (tag === 1) strings.push(decoder.decode(pbf.readBytes()));
}

function readPrimitiveBlockField(tag: number, result: PrimitiveBlock, pbf: Pbf) {
  if (tag === 1) result.strings = pbf.readMessage(readStringTableField, []);
  else if (tag === 2) result.groups.push(pbf.readBytes());
  else if (tag === 17) result.granularity = pbf.readVarint();
  else if (tag === 19) result.latOffset = pbf.readVarint(true);
  else if (tag === 20) result.lonOffset = pbf.readVarint(true);
}

function tagsFromIndexes(keys: number[], values: number[], strings: string[]) {
  const tags: Record<string, string> = {};
  for (let index = 0; index < Math.min(keys.length, values.length); index++) {
    const key = strings[keys[index]];
    const value = strings[values[index]];
    if (key !== undefined && value !== undefined) tags[key] = value;
  }
  return tags;
}

type RawNode = { id: number; keys: number[]; values: number[]; lat: number; lon: number };
function readNodeField(tag: number, result: RawNode, pbf: Pbf) {
  if (tag === 1) result.id = pbf.readSVarint();
  else if (tag === 2) result.keys = pbf.readPackedVarint();
  else if (tag === 3) result.values = pbf.readPackedVarint();
  else if (tag === 8) result.lat = pbf.readSVarint();
  else if (tag === 9) result.lon = pbf.readSVarint();
}

type RawDense = { ids: number[]; keysValues: number[]; lats: number[]; lons: number[] };
function readDenseField(tag: number, result: RawDense, pbf: Pbf) {
  if (tag === 1) result.ids = pbf.readPackedSVarint();
  else if (tag === 8) result.lats = pbf.readPackedSVarint();
  else if (tag === 9) result.lons = pbf.readPackedSVarint();
  else if (tag === 10) result.keysValues = pbf.readPackedVarint();
}

type RawWay = { id: number; keys: number[]; values: number[]; refs: number[] };
function readWayField(tag: number, result: RawWay, pbf: Pbf) {
  if (tag === 1) result.id = pbf.readVarint();
  else if (tag === 2) result.keys = pbf.readPackedVarint();
  else if (tag === 3) result.values = pbf.readPackedVarint();
  else if (tag === 8) result.refs = pbf.readPackedSVarint();
}

type RawRelation = {
  id: number;
  keys: number[];
  values: number[];
  roles: number[];
  refs: number[];
  types: number[];
};
function readRelationField(tag: number, result: RawRelation, pbf: Pbf) {
  if (tag === 1) result.id = pbf.readVarint();
  else if (tag === 2) result.keys = pbf.readPackedVarint();
  else if (tag === 3) result.values = pbf.readPackedVarint();
  else if (tag === 8) result.roles = pbf.readPackedVarint();
  else if (tag === 9) result.refs = pbf.readPackedSVarint();
  else if (tag === 10) result.types = pbf.readPackedVarint();
}

function coordinate(offset: number, granularity: number, raw: number) {
  return 1e-9 * (offset + granularity * raw);
}

function parseGroup(bytes: Uint8Array, block: PrimitiveBlock): OsmPbfEntity[] {
  const entities: OsmPbfEntity[] = [];
  const pbf = new Pbf(bytes);
  pbf.readFields((tag, _result, groupPbf) => {
    if (tag === 1) {
      const raw = groupPbf.readMessage(readNodeField, { id: 0, keys: [], values: [], lat: 0, lon: 0 });
      entities.push({
        type: "node",
        id: raw.id,
        lat: coordinate(block.latOffset, block.granularity, raw.lat),
        lon: coordinate(block.lonOffset, block.granularity, raw.lon),
        tags: tagsFromIndexes(raw.keys, raw.values, block.strings),
      });
    } else if (tag === 2) {
      const dense = groupPbf.readMessage(readDenseField, { ids: [], keysValues: [], lats: [], lons: [] });
      let id = 0;
      let lat = 0;
      let lon = 0;
      let tagIndex = 0;
      for (let index = 0; index < dense.ids.length; index++) {
        id += dense.ids[index];
        lat += dense.lats[index];
        lon += dense.lons[index];
        const keys: number[] = [];
        const values: number[] = [];
        while (tagIndex < dense.keysValues.length && dense.keysValues[tagIndex] !== 0) {
          keys.push(dense.keysValues[tagIndex++]);
          values.push(dense.keysValues[tagIndex++]);
        }
        tagIndex++;
        entities.push({
          type: "node",
          id,
          lat: coordinate(block.latOffset, block.granularity, lat),
          lon: coordinate(block.lonOffset, block.granularity, lon),
          tags: tagsFromIndexes(keys, values, block.strings),
        });
      }
    } else if (tag === 3) {
      const raw = groupPbf.readMessage(readWayField, { id: 0, keys: [], values: [], refs: [] });
      let ref = 0;
      const refs = raw.refs.map((delta) => (ref += delta));
      entities.push({ type: "way", id: raw.id, refs, tags: tagsFromIndexes(raw.keys, raw.values, block.strings) });
    } else if (tag === 4) {
      const raw = groupPbf.readMessage(readRelationField, { id: 0, keys: [], values: [], roles: [], refs: [], types: [] });
      let ref = 0;
      const typeNames = ["node", "way", "relation"] as const;
      const members = raw.refs.map((delta, index) => ({
        ref: (ref += delta),
        role: block.strings[raw.roles[index]] ?? "",
        type: typeNames[raw.types[index]] ?? "node",
      }));
      entities.push({ type: "relation", id: raw.id, members, tags: tagsFromIndexes(raw.keys, raw.values, block.strings) });
    }
  }, null);
  return entities;
}

export async function* readOsmPbf(filePath: string): AsyncGenerator<OsmPbfEntity> {
  const handle = await open(filePath, "r");
  let position = 0;
  try {
    const sizeBuffer = Buffer.alloc(4);
    while (true) {
      const sizeRead = await handle.read(sizeBuffer, 0, 4, position);
      if (sizeRead.bytesRead === 0) break;
      if (sizeRead.bytesRead !== 4) throw new Error("Truncated OSM PBF blob header length");
      position += 4;
      const headerLength = sizeBuffer.readUInt32BE(0);
      if (headerLength <= 0 || headerLength > 64 * 1024) throw new Error("Invalid OSM PBF blob header length");
      const headerBytes = Buffer.alloc(headerLength);
      if ((await handle.read(headerBytes, 0, headerLength, position)).bytesRead !== headerLength) {
        throw new Error("Truncated OSM PBF blob header");
      }
      position += headerLength;
      const header = new Pbf(headerBytes).readFields(readBlobHeaderField, { type: "", dataSize: 0 });
      if (header.dataSize <= 0 || header.dataSize > 64 * 1024 * 1024) throw new Error("Invalid OSM PBF blob size");
      const blobBytes = Buffer.alloc(header.dataSize);
      if ((await handle.read(blobBytes, 0, header.dataSize, position)).bytesRead !== header.dataSize) {
        throw new Error("Truncated OSM PBF blob");
      }
      position += header.dataSize;
      if (header.type !== "OSMData") continue;
      const blob = new Pbf(blobBytes).readFields(readBlobField, {} as Blob);
      const data = blob.raw ?? (blob.zlib ? await inflateAsync(blob.zlib) : null);
      if (!data) throw new Error("Unsupported OSM PBF blob compression");
      const block = new Pbf(data).readFields(readPrimitiveBlockField, {
        strings: [], groups: [], granularity: 100, latOffset: 0, lonOffset: 0,
      });
      for (const group of block.groups) {
        for (const entity of parseGroup(group, block)) yield entity;
      }
    }
  } finally {
    await handle.close();
  }
}
