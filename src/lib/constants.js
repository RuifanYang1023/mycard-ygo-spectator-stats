export const MYCARD_DUEL_LIST_URL = "wss://tiramisu.moecube.com:8923/?filter=started";
export const DEFAULT_GAME_HOST = "tiramisu.moenext.com";
export const DEFAULT_GAME_PORT = 8911;
export const PROTOCOL_VERSION = 4962;

export const SAPI_BASE_URL = "https://sapi.moecube.com:444";
export const ACCOUNTS_BASE_URL = "https://api.moecube.com";

export const DEFAULT_LOCAL_STORAGE_DIR =
  process.env.MYCARD_LOCAL_STORAGE_DIR ??
  process.env.APPDATA + "\\MyCard\\Local Storage\\leveldb";

export const LOCATION_NAMES = {
  0x01: "deck",
  0x02: "hand",
  0x04: "monster",
  0x08: "spell",
  0x10: "grave",
  0x20: "removed",
  0x40: "extra",
  0x80: "overlay",
};

export const REASON_NAMES = {
  0x01: "destroy",
  0x02: "release",
  0x03: "tribute",
  0x04: "material",
  0x05: "summon",
  0x06: "spsummon",
  0x07: "flip",
  0x08: "discard",
  0x09: "draw",
  0x0a: "effect",
  0x0b: "cost",
};
