import type { DiscoveryRect } from "./kakao-place-client.js";

export const SEOUL_DISCOVERY_BOUNDS = {
  minLongitude: 126.7,
  minLatitude: 37.4,
  maxLongitude: 127.3,
  maxLatitude: 37.75
} as const satisfies DiscoveryRect;

export const MAX_DISCOVERY_TILE_DEPTH = 8;

export interface DiscoveryTile {
  key: string;
  depth: number;
  bounds: DiscoveryRect;
}

export class DiscoveryTileError extends Error {
  readonly code = "DISCOVERY_TILE_SATURATED";

  constructor() {
    super("DISCOVERY_TILE_SATURATED");
    this.name = "DiscoveryTileError";
  }
}

export function createSeoulRootTile(): DiscoveryTile {
  return {
    key: "0",
    depth: 0,
    bounds: SEOUL_DISCOVERY_BOUNDS
  };
}

export function splitDiscoveryTile(
  tile: DiscoveryTile
): [DiscoveryTile, DiscoveryTile, DiscoveryTile, DiscoveryTile] {
  if (tile.depth >= MAX_DISCOVERY_TILE_DEPTH) {
    throw new DiscoveryTileError();
  }

  const longitudeMidpoint =
    (tile.bounds.minLongitude + tile.bounds.maxLongitude) / 2;
  const latitudeMidpoint =
    (tile.bounds.minLatitude + tile.bounds.maxLatitude) / 2;
  const childDepth = tile.depth + 1;

  return [
    {
      key: `${tile.key}.0`,
      depth: childDepth,
      bounds: {
        minLongitude: tile.bounds.minLongitude,
        minLatitude: tile.bounds.minLatitude,
        maxLongitude: longitudeMidpoint,
        maxLatitude: latitudeMidpoint
      }
    },
    {
      key: `${tile.key}.1`,
      depth: childDepth,
      bounds: {
        minLongitude: longitudeMidpoint,
        minLatitude: tile.bounds.minLatitude,
        maxLongitude: tile.bounds.maxLongitude,
        maxLatitude: latitudeMidpoint
      }
    },
    {
      key: `${tile.key}.2`,
      depth: childDepth,
      bounds: {
        minLongitude: tile.bounds.minLongitude,
        minLatitude: latitudeMidpoint,
        maxLongitude: longitudeMidpoint,
        maxLatitude: tile.bounds.maxLatitude
      }
    },
    {
      key: `${tile.key}.3`,
      depth: childDepth,
      bounds: {
        minLongitude: longitudeMidpoint,
        minLatitude: latitudeMidpoint,
        maxLongitude: tile.bounds.maxLongitude,
        maxLatitude: tile.bounds.maxLatitude
      }
    }
  ];
}
