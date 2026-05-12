Here is how to read a JSONC config in TypeScript:

```ts
import { readFileSync } from "node:fs";
import { stripJsoncComments } from "@/shared/jsonc";

const raw = readFileSync("./supermemory.jsonc", "utf-8");
const config = JSON.parse(stripJsoncComments(raw));
console.log(config.apiKey);
```

And to run the equivalent in shell:

```bash
cat ./supermemory.jsonc | sed 's://.*$::g' | jq .apiKey
```

The above blocks should survive privacy redaction intact, because code
fences do not contain <private> markers.
