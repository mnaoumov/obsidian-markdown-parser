# @mnaoumov/obsidian-markdown-parser-metadata

The `CachedMetadata` Obsidian's metadata worker posts for a note, computed outside Obsidian, and the `remark-parse` 8 engine it is built from. It has four small dependencies and no editor or CodeMirror, for a consumer such as a mock of Obsidian's metadata cache.

```ts
import { parseMetadata } from '@mnaoumov/obsidian-markdown-parser-metadata';

const metadata = parseMetadata('# Title\n\nSee [[Other note]] and #tag\n');
metadata?.links?.[0]?.link; // 'Other note'
```

`@mnaoumov/obsidian-markdown-parser-metadata/remark` exports `parseRemark` and `renderRemarkHtml`, the tree and HTML of Obsidian's reading view.

It is part of [obsidian-markdown-parser](https://github.com/mnaoumov/obsidian-markdown-parser), where the documentation, the accuracy figures and the whole parser live. Unofficial: not affiliated with or endorsed by Obsidian.
