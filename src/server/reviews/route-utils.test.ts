import { jsonRouteError } from "./route-utils";

describe("jsonRouteError", () => {
  it("returns a generic JSON response for unexpected errors", async () => {
    const response = jsonRouteError(new Error("database transaction expired"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error"
      }
    });
  });
});
