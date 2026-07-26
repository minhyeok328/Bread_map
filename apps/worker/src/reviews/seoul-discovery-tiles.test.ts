import { describe, expect, it } from "vitest";
import {
  MAX_DISCOVERY_TILE_DEPTH,
  SEOUL_DISCOVERY_BOUNDS,
  createSeoulRootTile,
  splitDiscoveryTile
} from "./seoul-discovery-tiles.js";

describe("Seoul discovery tiles", () => {
  it("creates the approved Seoul root bounds", () => {
    expect(createSeoulRootTile()).toEqual({
      key: "0",
      depth: 0,
      bounds: SEOUL_DISCOVERY_BOUNDS
    });
  });

  it("splits a tile into four children without gaps", () => {
    const parent = createSeoulRootTile();
    const children = splitDiscoveryTile(parent);
    const longitudeMidpoint =
      (parent.bounds.minLongitude + parent.bounds.maxLongitude) / 2;
    const latitudeMidpoint =
      (parent.bounds.minLatitude + parent.bounds.maxLatitude) / 2;

    expect(children).toEqual([
      {
        key: "0.0",
        depth: 1,
        bounds: {
          minLongitude: parent.bounds.minLongitude,
          minLatitude: parent.bounds.minLatitude,
          maxLongitude: longitudeMidpoint,
          maxLatitude: latitudeMidpoint
        }
      },
      {
        key: "0.1",
        depth: 1,
        bounds: {
          minLongitude: longitudeMidpoint,
          minLatitude: parent.bounds.minLatitude,
          maxLongitude: parent.bounds.maxLongitude,
          maxLatitude: latitudeMidpoint
        }
      },
      {
        key: "0.2",
        depth: 1,
        bounds: {
          minLongitude: parent.bounds.minLongitude,
          minLatitude: latitudeMidpoint,
          maxLongitude: longitudeMidpoint,
          maxLatitude: parent.bounds.maxLatitude
        }
      },
      {
        key: "0.3",
        depth: 1,
        bounds: {
          minLongitude: longitudeMidpoint,
          minLatitude: latitudeMidpoint,
          maxLongitude: parent.bounds.maxLongitude,
          maxLatitude: parent.bounds.maxLatitude
        }
      }
    ]);

    const parentArea =
      (parent.bounds.maxLongitude - parent.bounds.minLongitude) *
      (parent.bounds.maxLatitude - parent.bounds.minLatitude);
    const childrenArea = children.reduce(
      (total, child) =>
        total +
        (child.bounds.maxLongitude - child.bounds.minLongitude) *
          (child.bounds.maxLatitude - child.bounds.minLatitude),
      0
    );
    expect(childrenArea).toBeCloseTo(parentArea, 12);
  });

  it("stops saturated subdivision at the approved depth", () => {
    expect(() =>
      splitDiscoveryTile({
        key: "saturated",
        depth: MAX_DISCOVERY_TILE_DEPTH,
        bounds: SEOUL_DISCOVERY_BOUNDS
      })
    ).toThrow("DISCOVERY_TILE_SATURATED");
  });
});
