import { afterEach, beforeEach, spyOn } from "bun:test";
import * as ownership from "@/utils/discord/shardOwnership";

export function stubAllShardOwnership(): () => void {
  let restore = () => {};
  const apply = () => {
    const spy = spyOn(ownership, "getShardTopology").mockReturnValue(ownership.parseShardTopology({}));
    restore = () => spy.mockRestore();
  };
  beforeEach(apply);
  afterEach(() => restore());
  return apply;
}
