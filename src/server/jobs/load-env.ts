import path from "path";
import fs from "fs";

const cwd = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(cwd, f);
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (m) {
        const key = m[1].trim();
        const val = m[2].trim().replace(/^"|"$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
    break;
  }
}
