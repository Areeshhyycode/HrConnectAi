// Packs dist/ into hrconnect-ai-<version>.zip for the Chrome Web Store.
// Writes the ZIP by hand so the repo keeps a zero-runtime-dependency build.

import { deflateRawSync } from "node:zlib";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = "dist";
const version = JSON.parse(readFileSync(`${SRC}/manifest.json`, "utf8")).version;
const OUT = `hrconnect-ai-${version}.zip`;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// DOS timestamps have 2-second resolution and start at 1980.
function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const now = dosTime(new Date());
const locals = [];
const centrals = [];
let offset = 0;

for (const file of walk(SRC)) {
  const name = relative(SRC, file).split(sep).join("/"); // ZIP always uses "/"
  const nameBuf = Buffer.from(name, "utf8");
  const raw = readFileSync(file);
  const deflated = deflateRawSync(raw, { level: 9 });

  // Fall back to stored if deflate made it bigger (tiny files sometimes do).
  const useDeflate = deflated.length < raw.length;
  const data = useDeflate ? deflated : raw;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(now.time, 10);
  local.writeUInt16LE(now.day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28); // extra field length

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(now.time, 12);
  central.writeUInt16LE(now.day, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(offset, 42); // offset of the local header
  centrals.push(Buffer.concat([central, nameBuf]));

  const entry = Buffer.concat([local, nameBuf, data]);
  locals.push(entry);
  offset += entry.length;
}

const directory = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(centrals.length, 8);
end.writeUInt16LE(centrals.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);

writeFileSync(OUT, Buffer.concat([...locals, directory, end]));
console.log(`wrote ${OUT} (${centrals.length} files)`);
