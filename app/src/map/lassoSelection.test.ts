import { selectFeatureIdsWithinLasso } from "./lassoSelection";

describe("selectFeatureIdsWithinLasso", () => {
  it("selects contained points and crossing lines without requiring a closed input ring", () => {
    expect(selectFeatureIdsWithinLasso([
      { id: "point", geometry: { type: "Point", coordinates: [1, 1] } },
      { id: "line", geometry: { type: "LineString", coordinates: [[-2, 0], [2, 0]] } },
      { id: "outside", geometry: { type: "Point", coordinates: [4, 4] } },
    ], [[-1, -1], [3, -1], [3, 3], [-1, 3]])).toEqual(["point", "line"]);
  });
});
