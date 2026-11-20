import { describe, expect, test } from "bun:test";
import { mapWithConcurrency } from "@/utils/async/bounded";

describe("mapWithConcurrency", () => {
  test("bounds in-flight calls and preserves input order when completion is out of order", async () => {
    const gates = Array.from({ length: 4 }, () => Promise.withResolvers<number>());
    const started: number[] = [];
    let inFlight = 0;
    let maximum = 0;
    const result = mapWithConcurrency([0, 1, 2, 3], 2, async (item, index) => {
      expect(index).toBe(item);
      started.push(item);
      maximum = Math.max(maximum, ++inFlight);
      const value = await gates[item].promise;
      inFlight--;
      return value;
    });
    expect(started).toEqual([0, 1]);
    gates[1].resolve(11);
    await Bun.sleep(0);
    expect(started).toEqual([0, 1, 2]);
    gates[2].resolve(12);
    await Bun.sleep(0);
    expect(started).toEqual([0, 1, 2, 3]);
    gates[3].resolve(13);
    gates[0].resolve(10);
    expect(await result).toEqual([10, 11, 12, 13]);
    expect(maximum).toBe(2);
  });

  test("propagates rejection without waiting for another in-flight call", async () => {
    const pending = Promise.withResolvers<number>();
    const failure = new Error("worker failed");
    const result = mapWithConcurrency([0, 1], 2, (item) => (item === 0 ? pending.promise : Promise.reject(failure)));
    await expect(result).rejects.toBe(failure);
    pending.resolve(0);
    expect(await mapWithConcurrency([], 2, async (item: number) => item)).toEqual([]);
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(mapWithConcurrency([1], limit, async (item) => item)).rejects.toBeInstanceOf(RangeError);
    }
  });
});
