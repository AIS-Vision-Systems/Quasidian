// Pure module: no Tauri, no DOM. Parses the YAML subset Quasidian needs
// from a note's frontmatter (scalars, inline arrays, dash lists — enough
// for tags and aliases) and serializes it back. This is intentionally
// not a general YAML parser, and never a markdown parser.

export interface FrontmatterProperty {
  key: string;
  values: string[];
  /** Lists render as pills; scalars as plain values. */
  isList: boolean;
}

export interface FrontmatterData {
  exists: boolean;
  /** Offset just past the closing --- (0 when there is no frontmatter). */
  end: number;
  properties: FrontmatterProperty[];
  tags: string[];
  aliases: string[];
}

const EMPTY: FrontmatterData = {
  exists: false,
  end: 0,
  properties: [],
  tags: [],
  aliases: [],
};

/** Strips surrounding quotes and whitespace from a scalar. */
function cleanScalar(raw: string): string {
  const trimmed = raw.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return quoted && trimmed.length >= 2 ? trimmed.slice(1, -1) : trimmed;
}

function splitInlineArray(raw: string): string[] {
  return raw
    .slice(1, -1)
    .split(",")
    .map(cleanScalar)
    .filter((value) => value !== "");
}

export function parseFrontmatter(doc: string): FrontmatterData {
  const lines = doc.split("\n");
  if ((lines[0] ?? "").replace(/\r$/, "") !== "---") {
    return EMPTY;
  }
  // Offset of the start of each line, to report `end` in doc offsets.
  const starts: number[] = [0];
  for (let i = 0; i < lines.length; i++) {
    starts.push(starts[i] + lines[i].length + 1);
  }
  const properties: FrontmatterProperty[] = [];
  let end = doc.length;
  let index = 1;
  while (index < lines.length) {
    const line = lines[index].replace(/\r$/, "");
    if (line.trim() === "---") {
      end = starts[index] + lines[index].replace(/\r$/, "").length;
      break;
    }
    const match = /^([^\s-][^:]*):\s*(.*)$/.exec(line);
    if (match === null) {
      index++;
      continue;
    }
    const key = match[1].trim();
    const rest = match[2].trim();
    if (rest === "") {
      // Dash list on the following lines.
      const values: string[] = [];
      let next = index + 1;
      while (next < lines.length) {
        const item = /^\s+-\s+(.*)$/.exec(lines[next].replace(/\r$/, ""));
        if (item === null) {
          break;
        }
        const value = cleanScalar(item[1]);
        if (value !== "") {
          values.push(value);
        }
        next++;
      }
      properties.push({ key, values, isList: true });
      index = next;
      continue;
    }
    if (rest.startsWith("[") && rest.endsWith("]")) {
      properties.push({ key, values: splitInlineArray(rest), isList: true });
    } else {
      properties.push({ key, values: [cleanScalar(rest)], isList: false });
    }
    index++;
  }
  const collect = (names: string[]): string[] => {
    const found: string[] = [];
    for (const property of properties) {
      if (names.includes(property.key.toLowerCase())) {
        for (const value of property.values) {
          const cleaned = value.replace(/^#/, "").trim();
          if (cleaned !== "" && !found.includes(cleaned)) {
            found.push(cleaned);
          }
        }
      }
    }
    return found;
  };
  return {
    exists: true,
    end,
    properties,
    tags: collect(["tags", "tag"]),
    aliases: collect(["aliases", "alias"]),
  };
}

/** Serializes properties back to a frontmatter block (no trailing \n). */
export function serializeFrontmatter(
  properties: FrontmatterProperty[],
): string {
  const lines = ["---"];
  for (const property of properties) {
    if (property.isList || property.values.length > 1) {
      lines.push(`${property.key}:`);
      for (const value of property.values) {
        lines.push(`  - ${value}`);
      }
    } else {
      lines.push(`${property.key}: ${property.values[0] ?? ""}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}
