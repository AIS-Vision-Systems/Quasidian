import { describe, expect, it } from "vitest";
import { renderToHtml } from "./render";

describe("renderToHtml — blocks", () => {
  it("renders headings without marks, with their document position", () => {
    expect(renderToHtml("# Títol")).toBe('<h1 data-pos="0">Títol</h1>');
    expect(renderToHtml("### Fondo")).toBe('<h3 data-pos="0">Fondo</h3>');
  });

  it("renders paragraphs and inline formatting", () => {
    expect(renderToHtml("**fort** i *suau*")).toBe(
      "<p><strong>fort</strong> i <em>suau</em></p>",
    );
    expect(renderToHtml("~~fora~~")).toBe("<p><del>fora</del></p>");
    expect(renderToHtml("`codi`")).toBe("<p><code>codi</code></p>");
  });

  it("renders blockquotes", () => {
    expect(renderToHtml("> cita")).toBe(
      "<blockquote><p>cita</p></blockquote>",
    );
  });

  it("renders dash setext headings only with 3+ dashes", () => {
    expect(renderToHtml("Títol\n---")).toBe('<h2 data-pos="0">Títol</h2>');
    expect(renderToHtml("Títol\n===")).toBe('<h1 data-pos="0">Títol</h1>');
    expect(renderToHtml("Text\n- ")).toBe("<p>Text<br>- </p>");
  });

  it("renders soft line breaks as real breaks, Obsidian-style", () => {
    expect(renderToHtml("Imatge:\n![[img.png]]")).toBe(
      '<p>Imatge:<br><img class="internal-embed" data-target="img.png" alt="img.png"></p>',
    );
    expect(renderToHtml("una\ndues")).toBe("<p>una<br>dues</p>");
  });

  it("renders bullet and ordered lists with item positions", () => {
    expect(renderToHtml("- a\n- b")).toBe(
      '<ul><li data-pos="0"><p>a</p></li><li data-pos="4"><p>b</p></li></ul>',
    );
    expect(renderToHtml("1. a")).toBe(
      '<ol><li data-pos="0"><p>a</p></li></ol>',
    );
  });

  it("renders fenced code with language class and display-name label", () => {
    const html = renderToHtml("```js\ncrida()\n```");
    expect(html).toContain('<pre data-lang="JavaScript"><code class="language-js">');
    expect(html).toContain("crida()");
    expect(html).toContain("</code></pre>");
  });

  it("renders ==highlights== as mark", () => {
    expect(renderToHtml("un ==ressaltat== aquí")).toBe(
      "<p>un <mark>ressaltat</mark> aquí</p>",
    );
  });

  it("renders math as placeholders for the view to typeset", () => {
    expect(renderToHtml("val $x+y$")).toBe(
      '<p>val <span class="math-inline" data-tex="x+y">x+y</span></p>',
    );
    expect(renderToHtml("a $$b$$ c")).toBe(
      '<p>a <span class="math-block" data-tex="b">b</span> c</p>',
    );
    expect(renderToHtml("$$\nE=mc^2\n$$")).toBe(
      '<span class="math-block" data-tex="E=mc^2">E=mc^2</span>',
    );
  });

  it("renders horizontal rules", () => {
    // Not at the very start: an opening --- there is frontmatter.
    expect(renderToHtml("text\n\n---")).toBe("<p>text</p><hr>");
  });

  it("renders frontmatter as a properties block", () => {
    const html = renderToHtml('---\ntags: [a, b]\ntitle: "La nota"\n---\ncos');
    expect(html).toContain('class="props-title"');
    expect(html).toContain('class="props-pill"');
    expect(html).toContain(">a<");
    expect(html).toContain("La nota");
    expect(html).not.toContain("---");
    expect(html).toContain("<p>cos</p>");
  });

  it("renders nothing for an empty frontmatter in reading mode", () => {
    expect(renderToHtml("---\n---\ntext")).toBe("<p>text</p>");
  });

  it("renders tables with header and body", () => {
    const html = renderToHtml("| a | b |\n| --- | --- |\n| c | d |");
    expect(html).toContain("<table><thead><tr><th>a</th><th>b</th></tr></thead>");
    expect(html).toContain("<tbody><tr><td>c</td><td>d</td></tr></tbody>");
  });
});

describe("renderToHtml — task lists", () => {
  it("renders checkboxes with document positions", () => {
    const html = renderToHtml("- [ ] fer\n- [x] fet");
    expect(html).toContain('<li class="task-list-item" data-pos="0">');
    expect(html).toContain('data-pos="2"');
    expect(html).toContain('data-pos="12"');
    expect(html).toContain("checked");
    expect(html).toContain("fer");
    expect(html).toContain("fet");
  });
});

describe("renderToHtml — links", () => {
  it("renders external links with href", () => {
    expect(renderToHtml("[web](https://exemple.cat)")).toBe(
      '<p><a class="external-link" href="https://exemple.cat">web</a></p>',
    );
  });

  it("renders relative link targets as internal links", () => {
    expect(renderToHtml("[nota](nota.md)")).toBe(
      '<p><a class="internal-link" data-target="nota.md">nota</a></p>',
    );
  });

  it("renders autolinks", () => {
    expect(renderToHtml("<https://exemple.cat>")).toBe(
      '<p><a class="external-link" href="https://exemple.cat">https://exemple.cat</a></p>',
    );
  });

  it("renders images", () => {
    expect(renderToHtml("![alt](img.png)")).toBe(
      '<p><img src="img.png" alt="alt"></p>',
    );
  });
});

describe("renderToHtml — wikilinks (same cases as the editor decorations)", () => {
  it("renders a plain wikilink", () => {
    expect(renderToHtml("[[nota]]")).toBe(
      '<p><a class="internal-link" data-target="nota">nota</a></p>',
    );
  });

  it("renders an aliased wikilink showing only the alias", () => {
    expect(renderToHtml("[[nota|àlies]]")).toBe(
      '<p><a class="internal-link" data-target="nota">àlies</a></p>',
    );
  });

  it("renders relative-path wikilinks", () => {
    expect(renderToHtml("[[../altres/nota]]")).toBe(
      '<p><a class="internal-link" data-target="../altres/nota">../altres/nota</a></p>',
    );
  });
});

describe("renderToHtml — embeds", () => {
  it("renders image embeds without src, resolved later by the view", () => {
    expect(renderToHtml("![[img.png]]")).toBe(
      '<p><img class="internal-embed" data-target="img.png" alt="img.png"></p>',
    );
  });

  it("uses a non-numeric alias as alt text", () => {
    expect(renderToHtml("![[img.png|logo]]")).toBe(
      '<p><img class="internal-embed" data-target="img.png" alt="logo"></p>',
    );
  });

  it("uses a numeric alias as display width, Obsidian-style", () => {
    expect(renderToHtml("![[img.png|50]]")).toBe(
      '<p><img class="internal-embed" data-target="img.png" alt="img.png" width="50"></p>',
    );
    expect(renderToHtml("![[img.png|300x200]]")).toBe(
      '<p><img class="internal-embed" data-target="img.png" alt="img.png" width="300" height="200"></p>',
    );
  });

  it("renders non-image embeds as transclusion placeholders", () => {
    expect(renderToHtml("![[nota]]")).toBe(
      '<p><span class="internal-embed embed-note" data-target="nota">nota</span></p>',
    );
  });
});

describe("renderToHtml — safety", () => {
  it("escapes raw HTML blocks instead of injecting them", () => {
    const html = renderToHtml("<script>alert('x')</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes inline HTML tags", () => {
    const html = renderToHtml("text <b>cru</b> aquí");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("escapes text content", () => {
    expect(renderToHtml("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
  });

  it("omits syntax marks from the output", () => {
    expect(renderToHtml("**b**")).not.toContain("*");
    expect(renderToHtml("# t")).not.toContain("#");
    expect(renderToHtml("[[n]]")).not.toContain("[[");
  });
});
