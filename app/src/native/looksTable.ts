/**
 * THE nlook FORMAT 1 TABLES, MIRRORED FOR THE PHONE'S JAVASCRIPT.
 *
 * SOURCE OF TRUTH: TAILZU-BACKEND/shared/types/nlook.ts. This file is those closed tables copied as data (no logic beyond the
 * lookups the server's file has), because the app is its own repo and cannot import the backend's. looksTable.test.ts compares
 * every table here with the backend's file whenever both are on disk, so a change over there that is not copied here fails a test
 * instead of drifting. Format 1 is frozen into the binary: a table only ever grows with a NativeLook2.
 */

export type NLookSurface = "widget" | "activity" | "liveupdate";
export type NLookType = "V" | "H" | "Z" | "Spacer" | "Grid" | "Text" | "Image" | "Bot" | "Shape" | "Bar" | "Ring" | "Kit" | "Each" | "Button";
export type BindKind = "text" | "number" | "bool" | "date" | "color" | "list" | "link";
export interface BindPath {
  readonly on: readonly NLookSurface[];
  readonly kind: BindKind;
  readonly sensitive?: true;
  readonly items?: readonly string[];
  readonly sensitiveItems?: readonly string[];
  readonly itemLists?: Readonly<Record<string, string>>;
  readonly scalar?: true;
}

export const NLOOK_FORMAT: 1 = 1;

export const NLOOK_CAPS: Readonly<Record<string, string>> = {
  "nativeLook": "NativeLook",
  "keySkin": "KeySkin",
  "look1": "NativeLook1",
  "keySkin1": "KeySkin1",
  "activityPushStart": "ActivityPushStart",
  "liveUpdate1": "LiveUpdate1",
  "widgetBoard1": "WidgetBoard1"
};

export const WIDGET_ROOTS: readonly string[] = [
  "small",
  "medium",
  "large",
  "inline",
  "rect",
  "circle"
];

export const ACTIVITY_ROOTS: readonly string[] = [
  "lock",
  "island.leading",
  "island.trailing",
  "island.center",
  "island.bottom",
  "compact.leading",
  "compact.trailing",
  "minimal"
];

export const ANDROID_WIDGET_ROOTS: readonly string[] = [
  "small",
  "medium",
  "large"
];

export const NLOOK_SURFACES: Readonly<Record<NLookSurface, { readonly roots: readonly string[]; readonly without: readonly NLookType[]; readonly eachMax: number; readonly platforms: readonly ("ios" | "android")[] }>> = {
  "widget": {
    "roots": [
      "small",
      "medium",
      "large",
      "inline",
      "rect",
      "circle"
    ],
    "without": [],
    "eachMax": 8,
    "platforms": [
      "ios",
      "android"
    ]
  },
  "activity": {
    "roots": [
      "lock",
      "island.leading",
      "island.trailing",
      "island.center",
      "island.bottom",
      "compact.leading",
      "compact.trailing",
      "minimal"
    ],
    "without": [
      "Grid"
    ],
    "eachMax": 3,
    "platforms": [
      "ios"
    ]
  },
  "liveupdate": {
    "roots": [],
    "without": [],
    "eachMax": 0,
    "platforms": [
      "android"
    ]
  }
};

export const NLOOK_TYPES: readonly NLookType[] = [
  "V",
  "H",
  "Z",
  "Spacer",
  "Grid",
  "Text",
  "Image",
  "Bot",
  "Shape",
  "Bar",
  "Ring",
  "Kit",
  "Each",
  "Button"
];

export const NLOOK_STYLE_KEYS: readonly string[] = [
  "pad",
  "w",
  "h",
  "maxW",
  "maxH",
  "bg",
  "corner",
  "border",
  "opacity",
  "align",
  "offset",
  "accent",
  "sensitive"
];

export const NLOOK_PROPS: Readonly<Record<NLookType, readonly string[]>> = {
  "V": [
    "gap",
    "align"
  ],
  "H": [
    "gap",
    "align"
  ],
  "Z": [
    "align"
  ],
  "Spacer": [
    "min"
  ],
  "Grid": [
    "cols",
    "gap"
  ],
  "Text": [
    "text",
    "font",
    "size",
    "weight",
    "track",
    "lines",
    "minScale",
    "align",
    "case",
    "digits",
    "tint",
    "timer",
    "countdown",
    "relative",
    "change"
  ],
  "Image": [
    "src",
    "fit",
    "size",
    "tint",
    "alt"
  ],
  "Bot": [
    "who",
    "moment",
    "at",
    "size"
  ],
  "Shape": [
    "kind",
    "fill",
    "stroke",
    "width",
    "d",
    "viewBox",
    "grid",
    "spacing",
    "dot"
  ],
  "Bar": [
    "value",
    "of",
    "segments",
    "color",
    "track"
  ],
  "Ring": [
    "value",
    "of",
    "width"
  ],
  "Kit": [
    "name",
    "props"
  ],
  "Each": [
    "of",
    "max",
    "as"
  ],
  "Button": [
    "act",
    "open"
  ]
};

export const SHAPE_KINDS: readonly string[] = [
  "rect",
  "capsule",
  "circle",
  "ring",
  "path",
  "dots"
];

export const KIT_NAMES: readonly string[] = [
  "askBar",
  "stripes",
  "beads",
  "pill",
  "mark"
];

export const TEXT_CHANGES: readonly string[] = [
  "numeric",
  "fade",
  "push",
  "none"
];

export const IMAGE_FITS: readonly string[] = [
  "fill",
  "fit",
  "stretch"
];

export const IMAGE_SRC_PREFIXES: readonly string[] = [
  "art:",
  "face:",
  "pose:",
  "sym:"
];

export const PALETTE_ROLES: readonly string[] = [
  "ground",
  "ink",
  "paper",
  "meta",
  "dim",
  "line",
  "surface",
  "accent",
  "outline",
  "hollow"
];

export const ROLE_FALLBACK: Readonly<Record<string, string>> = {
  "paper": "ground",
  "dim": "meta",
  "outline": "line",
  "hollow": "line"
};

export const TYPE_TOKENS: readonly string[] = [
  "sans",
  "brand",
  "display",
  "dots",
  "mono"
];

export const TEXT_WEIGHTS: readonly number[] = [
  400,
  500,
  600,
  700,
  800
];

export const CONDITION_KEYS: readonly string[] = [
  "family",
  "appearance",
  "mode",
  "reduced",
  "case",
  "phase",
  "has",
  "platform",
  "canAnswer",
  "standby"
];

export const LINK_ALLOW: { readonly scheme: string; readonly httpsPrefix: string } = {
  "scheme": "tulmi",
  "httpsPrefix": "https://github.com/"
};

export const BIND_PATHS: Readonly<Record<string, BindPath>> = {
  "case": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "greeting.hello": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "greeting.line": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "greeting.part": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "summary": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "week.done": {
    "on": [
      "widget"
    ],
    "kind": "number"
  },
  "week.minutesSaved": {
    "on": [
      "widget"
    ],
    "kind": "number"
  },
  "week.dots": {
    "on": [
      "widget"
    ],
    "kind": "number"
  },
  "week.line": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "bots": {
    "on": [
      "widget"
    ],
    "kind": "list",
    "items": [
      "slug",
      "name",
      "color",
      "face",
      "faceUrl",
      "state",
      "needs",
      "working",
      "line",
      "link"
    ]
  },
  "more": {
    "on": [
      "widget"
    ],
    "kind": "number"
  },
  "needs.count": {
    "on": [
      "widget"
    ],
    "kind": "number"
  },
  "needs.items": {
    "on": [
      "widget"
    ],
    "kind": "list",
    "items": [
      "id",
      "kind",
      "bot",
      "botName",
      "face",
      "question",
      "choices",
      "decideLink",
      "private",
      "answerable",
      "link",
      "at"
    ],
    "sensitiveItems": [
      "question"
    ],
    "itemLists": {
      "choices": "needs.items[].choices"
    }
  },
  "needs.items[].choices": {
    "on": [
      "widget"
    ],
    "kind": "list",
    "items": [
      "id",
      "label",
      "primary"
    ]
  },
  "job.id": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "job.bot": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "job.task": {
    "on": [
      "widget"
    ],
    "kind": "text",
    "sensitive": true
  },
  "job.stage": {
    "on": [
      "widget"
    ],
    "kind": "number"
  },
  "job.of": {
    "on": [
      "widget"
    ],
    "kind": "number"
  },
  "job.stageName": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "job.stages": {
    "on": [
      "widget"
    ],
    "kind": "list",
    "scalar": true
  },
  "job.startedAt": {
    "on": [
      "widget"
    ],
    "kind": "date"
  },
  "job.phase": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "job.link": {
    "on": [
      "widget"
    ],
    "kind": "link"
  },
  "lastDone.id": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "lastDone.bot": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "lastDone.botName": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "lastDone.face": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "lastDone.result": {
    "on": [
      "widget"
    ],
    "kind": "text",
    "sensitive": true
  },
  "lastDone.endedAt": {
    "on": [
      "widget"
    ],
    "kind": "date"
  },
  "lastDone.minutes": {
    "on": [
      "widget"
    ],
    "kind": "number"
  },
  "lastDone.failed": {
    "on": [
      "widget"
    ],
    "kind": "bool"
  },
  "lastDone.pr.number": {
    "on": [
      "widget"
    ],
    "kind": "number"
  },
  "lastDone.pr.url": {
    "on": [
      "widget"
    ],
    "kind": "link"
  },
  "lastDone.link": {
    "on": [
      "widget"
    ],
    "kind": "link"
  },
  "counts.working": {
    "on": [
      "widget"
    ],
    "kind": "number"
  },
  "counts.needs": {
    "on": [
      "widget"
    ],
    "kind": "number"
  },
  "lock.inline": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "lock.title": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "lock.line": {
    "on": [
      "widget"
    ],
    "kind": "text"
  },
  "links.ask": {
    "on": [
      "widget"
    ],
    "kind": "link"
  },
  "links.home": {
    "on": [
      "widget"
    ],
    "kind": "link"
  },
  "links.mic": {
    "on": [
      "widget"
    ],
    "kind": "link"
  },
  "bot": {
    "on": [
      "activity",
      "liveupdate"
    ],
    "kind": "text"
  },
  "botName": {
    "on": [
      "activity",
      "liveupdate"
    ],
    "kind": "text"
  },
  "face": {
    "on": [
      "activity",
      "liveupdate"
    ],
    "kind": "text"
  },
  "task": {
    "on": [
      "activity",
      "liveupdate"
    ],
    "kind": "text",
    "sensitive": true
  },
  "stage": {
    "on": [
      "activity",
      "liveupdate"
    ],
    "kind": "number"
  },
  "of": {
    "on": [
      "activity",
      "liveupdate"
    ],
    "kind": "number"
  },
  "stageName": {
    "on": [
      "activity",
      "liveupdate"
    ],
    "kind": "text"
  },
  "stages": {
    "on": [
      "activity",
      "liveupdate"
    ],
    "kind": "list",
    "scalar": true
  },
  "startedAt": {
    "on": [
      "activity",
      "liveupdate"
    ],
    "kind": "date"
  },
  "phase": {
    "on": [
      "activity",
      "liveupdate"
    ],
    "kind": "text"
  },
  "question": {
    "on": [
      "activity"
    ],
    "kind": "text",
    "sensitive": true
  },
  "choices": {
    "on": [
      "activity"
    ],
    "kind": "list",
    "items": [
      "id",
      "label",
      "primary"
    ]
  },
  "itemId": {
    "on": [
      "activity"
    ],
    "kind": "text"
  },
  "itemKind": {
    "on": [
      "activity"
    ],
    "kind": "text"
  },
  "decideLink": {
    "on": [
      "activity",
      "liveupdate"
    ],
    "kind": "link"
  },
  "private": {
    "on": [
      "activity"
    ],
    "kind": "bool"
  },
  "result": {
    "on": [
      "activity"
    ],
    "kind": "text",
    "sensitive": true
  },
  "failed": {
    "on": [
      "activity"
    ],
    "kind": "bool"
  },
  "minutes": {
    "on": [
      "activity"
    ],
    "kind": "number"
  },
  "pr.number": {
    "on": [
      "activity"
    ],
    "kind": "number"
  },
  "pr.url": {
    "on": [
      "activity"
    ],
    "kind": "link"
  },
  "link": {
    "on": [
      "activity",
      "liveupdate"
    ],
    "kind": "link"
  },
  "words.*": {
    "on": [
      "widget",
      "activity",
      "liveupdate"
    ],
    "kind": "text"
  },
  "vars.*": {
    "on": [
      "widget",
      "activity",
      "liveupdate"
    ],
    "kind": "text",
    "sensitive": true
  }
};

export const EACH_LISTS: readonly string[] = [
  "bots",
  "needs.items",
  "needs.items[].choices",
  "job.stages",
  "stages",
  "choices"
];

export const PATH_COMMANDS: readonly string[] = [
  "M",
  "L",
  "Q",
  "C",
  "Z",
  "O"
];

/** Design ids: [a-z0-9._-], 1 to 40 characters. */
export const ID_PATTERN = /^[a-z0-9._-]{1,40}$/;

export const NLOOK_LIMITS = {
  "catalogBytes": 262144,
  "widget": {
    "designBytes": 16384,
    "nodes": 150,
    "nodesPerRoot": 80,
    "depth": 10
  },
  "activity": {
    "designBytes": 8192,
    "nodesPerRoot": {
      "lock": 50,
      "island": 20,
      "compact": 6,
      "minimal": 3
    }
  },
  "android": {
    "levels": 8,
    "eachCopies": 8,
    "viewsPerSize": 60,
    "minSdk": 31,
    "bitmapBudgetShare": 0.7
  },
  "activityBodyBytes": 3584,
  "vars": {
    "keys": 12,
    "keyChars": 24,
    "valueChars": 120
  },
  "textChars": 200,
  "eachMax": 8,
  "path": {
    "dChars": 900,
    "perShape": 12
  },
  "art": {
    "fileBytes": 524288,
    "longEdgePx": 1200,
    "files": 64,
    "totalBytes": 6291456,
    "stillFiles": 24,
    "stillBytes": 2097152,
    "decodedIosBytes": 12582912,
    "regionMaxPx": {
      "island": 135,
      "lock": 252
    }
  },
  "fonts": {
    "fileBytes": 307200,
    "inCatalog": 4
  }
} as const;

export const EACH_ITEM_PREFIX = "it.";
export const INDEXED_PATH = /^([a-z][a-zA-Z.]*)\[([0-7])\]\.(.+)$/;
export const BIND_OPEN = "{{";
export const BIND_CLOSE = "}}";
export const BOT_ART_PREFIX = "bot:";

export const WORD_SLOTS: Readonly<Record<string, Readonly<Record<string, { readonly widget: { readonly path: string } | { readonly minutesSince: string } | null; readonly state: { readonly path: string } | { readonly minutesSince: string } | null }>>>> = {
  "step": {
    "stage": {
      "widget": {
        "path": "job.stage"
      },
      "state": {
        "path": "stage"
      }
    },
    "of": {
      "widget": {
        "path": "job.of"
      },
      "state": {
        "path": "of"
      }
    }
  },
  "working": {
    "n": {
      "widget": {
        "path": "counts.working"
      },
      "state": null
    }
  },
  "minIn": {
    "n": {
      "widget": {
        "minutesSince": "job.startedAt"
      },
      "state": {
        "minutesSince": "startedAt"
      }
    }
  },
  "min": {
    "n": {
      "widget": {
        "path": "lastDone.minutes"
      },
      "state": {
        "path": "minutes"
      }
    }
  },
  "pr": {
    "n": {
      "widget": {
        "path": "lastDone.pr.number"
      },
      "state": {
        "path": "pr.number"
      }
    }
  }
};


// ---------------------------------------------------------------- the lookups the server's file has

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The path a `{{...}}` names, or null when it is not one this build knows (it then resolves to an empty string). */
export function bindPathInfo(path: string): BindPath | null {
  if (has(BIND_PATHS, path)) return BIND_PATHS[path]!;
  const indexed = INDEXED_PATH.exec(path);
  if (indexed) {
    const [, listPath, , rest] = indexed;
    const list = has(BIND_PATHS, listPath!) ? BIND_PATHS[listPath!] : undefined;
    if (!list || list.kind !== "list") return null;
    return itemInfo(list, rest!);
  }
  const dot = path.indexOf(".");
  if (dot <= 0) return null;
  const prefix = `${path.slice(0, dot)}.*`;
  if (!has(BIND_PATHS, prefix)) return null;
  return path.indexOf(".", dot + 1) === -1 ? BIND_PATHS[prefix]! : null;
}

function itemInfo(list: BindPath, rest: string): BindPath | null {
  const nested = INDEXED_PATH.exec(rest);
  if (nested) {
    const [, name, , deeper] = nested;
    const key = list.itemLists?.[name!];
    if (!key || !has(BIND_PATHS, key)) return null;
    return itemInfo(BIND_PATHS[key]!, deeper!);
  }
  if (rest.includes(".")) return null;
  if (!list.items?.includes(rest)) return null;
  const sensitive = list.sensitive === true || list.sensitiveItems?.includes(rest) === true;
  return { on: list.on, kind: "text", ...(sensitive ? { sensitive: true as const } : {}) };
}

/** The EACH_LISTS key an `Each.of` names, or null. A literal index picks WHICH item, not which list. */
export function eachListKey(of: string): string | null {
  const key = of.replace(/\[[0-7]\]/g, "[]");
  return EACH_LISTS.includes(key) ? key : null;
}

/** What a child of an `Each` may bind: `it` for a list of plain strings, `it.<name>` otherwise. */
export function eachItemInfo(listPath: string, binding: string): BindPath | null {
  const list = has(BIND_PATHS, listPath) ? BIND_PATHS[listPath] : undefined;
  if (!list || list.kind !== "list") return null;
  if (binding === "it") return list.scalar ? { on: list.on, kind: "text" } : null;
  if (!binding.startsWith(EACH_ITEM_PREFIX)) return null;
  return list.scalar ? null : itemInfo(list, binding.slice(EACH_ITEM_PREFIX.length));
}

/** Whether a build may bind this path on this surface at all. */
export function bindsOn(path: string, surface: NLookSurface): boolean {
  const info = bindPathInfo(path);
  return !!info && info.on.includes(surface);
}

/** The `activity` node cap for a root: island.* and compact.* share theirs. */
export function activityNodeCap(root: string): number {
  const caps = NLOOK_LIMITS.activity.nodesPerRoot;
  if (root === "lock") return caps.lock;
  if (root === "minimal") return caps.minimal;
  if (root.startsWith("island.")) return caps.island;
  if (root.startsWith("compact.")) return caps.compact;
  return caps.minimal;
}
