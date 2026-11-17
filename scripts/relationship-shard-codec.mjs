/** Lossless dictionary encoding of derived summaries; decode only the requested lemma. */
export function packLemmaShard(shard) {
  const strings = [], ids = new Map();
  const intern = (value) => {
    if (!ids.has(value)) {
      ids.set(value, strings.length);
      strings.push(value);
    }
    return ids.get(value);
  };
  const encode = (value) => {
    if (typeof value === "string") return [intern(value)];
    if (Array.isArray(value)) return [null, ...value.map(encode)];
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [intern(k), encode(v)]),
      );
    }
    return value;
  };
  return {
    schema_version: "dictionary-1",
    strings,
    entries: Object.fromEntries(
      Object.entries(shard.entries).map(([k, v]) => [k, encode(v)]),
    ),
  };
}

export function lemmaShardEntry(shard, key) {
  if (shard?.schema_version !== "dictionary-1") return shard?.entries?.[key];
  const decode = (value) => {
    if (Array.isArray(value)) {
      return value[0] === null
        ? value.slice(1).map(decode)
        : shard.strings[value[0]];
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map((
          [k, v],
        ) => [shard.strings[Number(k)], decode(v)]),
      );
    }
    return value;
  };
  return decode(shard.entries[key]);
}

export async function packedShardEntry(shard, key, base, load) {
  if (shard?.schema_version !== "packed-1") return shard?.chapters?.[key];
  const entry = shard.entries?.[key];
  if (!entry) return null;
  const [file, start, length] = entry;
  return load(`${base}/${file}#bytes=${start}-${start + length - 1}`);
}
