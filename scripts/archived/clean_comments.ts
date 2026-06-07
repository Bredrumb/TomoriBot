import fs from "fs";
import path from "path";

const dir = "c:/Github/TomoriBot/src/utils/db/repositories";
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => path.join(dir, f));

for (const file of files) {
  let content = fs.readFileSync(file, "utf8");
  content = content.replace(/\(Phase 6 Stage A\)/g, "(Phase 6)");
  content = content.replace(/Stage A: /g, "");
  content = content.replace(/Stage B: /g, "");
  content = content.replace(/Stage A /g, "");
  content = content.replace(/Phase 6 Stage A/g, "Phase 6");
  fs.writeFileSync(file, content);
}
console.log("Comments cleaned.");
