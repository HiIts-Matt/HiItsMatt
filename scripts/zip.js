import { crc32, deflateRawSync } from "node:zlib";

/**
 * Minimal ZIP writer, because the alternatives are all worse here:
 * `zip` is not on Windows, and PowerShell's Compress-Archive has historically
 * written backslash separators into the archive, which Lambda unpacks into one
 * file literally named "dist-lambda\index.mjs".
 *
 * Only what a Lambda deployment package needs: deflate, no encryption, no
 * data descriptors, no zip64. A bundled handler is a few hundred kilobytes.
 */

// Fixed 1980-01-01 00:00 (the DOS epoch, the earliest a zip can express) so the
// same bundle always produces byte-identical output: an unchanged CodeSha256
// after a deploy then means the code genuinely did not change.
const DOS_TIME = 0;
const DOS_DATE = 33; // (1980-1980) << 9 | 1 << 5 | 1

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Made by UNIX (3), needs 2.0; pairs with the 0644 external attributes below. */
const VERSION_MADE_BY = (3 << 8) | 20;
const VERSION_NEEDED = 20;
const METHOD_DEFLATE = 8;
// >>> 0 because `<<` works on signed 32-bit ints and 0o100644 << 16 overflows
// into a negative number, which writeUInt32LE rejects.
const UNIX_0644 = (0o100644 << 16) >>> 0;

/**
 * @param {Array<{ name: string, data: Buffer }>} entries Archive members. Names
 *   are used verbatim and must already use forward slashes.
 * @returns {Buffer} The complete archive.
 */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(UNIX_0644, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const directory = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with the central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, directory, eocd]);
}
