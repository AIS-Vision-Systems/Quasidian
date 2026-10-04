import { describe, expect, it } from "vitest";
import {
  embedTargetFor,
  embedText,
  extensionForMime,
  isAdmittedFile,
  isGenericClipboardName,
  nameTakenIn,
  pastedImageName,
  toClientPoint,
  uniqueName,
} from "./attachments";
import type { FolderFile } from "./wikilinks";

describe("isAdmittedFile", () => {
  it("admits notes and images, whatever the case", () => {
    for (const name of [
      "nota.md",
      "Nota.MD",
      "foto.png",
      "foto.JPG",
      "foto.jpeg",
      "anim.gif",
      "foto.webp",
      "logo.svg",
      "mapa.bmp",
    ]) {
      expect(isAdmittedFile(name)).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const name of [
      "informe.pdf",
      "dades.csv",
      "text.txt",
      "arxiu.zip",
      "sense-extensio",
      "carpeta",
      ".md.bak",
      "",
    ]) {
      expect(isAdmittedFile(name)).toBe(false);
    }
  });
});

describe("extensionForMime", () => {
  it("maps the image types a clipboard carries", () => {
    expect(extensionForMime("image/png")).toBe(".png");
    expect(extensionForMime("image/jpeg")).toBe(".jpg");
    expect(extensionForMime("image/svg+xml")).toBe(".svg");
    expect(extensionForMime(" IMAGE/PNG ")).toBe(".png");
  });

  it("is null for anything that is not an admitted image", () => {
    expect(extensionForMime("application/pdf")).toBeNull();
    expect(extensionForMime("text/plain")).toBeNull();
    expect(extensionForMime("image/tiff")).toBeNull();
    expect(extensionForMime("")).toBeNull();
  });
});

describe("isGenericClipboardName", () => {
  it("recognizes the name a screenshot arrives with", () => {
    expect(isGenericClipboardName("image.png")).toBe(true);
    expect(isGenericClipboardName("Image.JPG")).toBe(true);
    expect(isGenericClipboardName("")).toBe(true);
  });

  it("keeps a name the user gave the file", () => {
    expect(isGenericClipboardName("diagrama.png")).toBe(false);
    expect(isGenericClipboardName("image 2.png")).toBe(false);
  });
});

describe("pastedImageName", () => {
  it("stamps the local date and time down to the second", () => {
    expect(
      pastedImageName("Imatge enganxada", new Date(2026, 9, 4, 15, 30, 12), ".png"),
    ).toBe("Imatge enganxada 20261004153012.png");
  });

  it("pads every component", () => {
    expect(
      pastedImageName("Pasted image", new Date(2027, 0, 2, 3, 4, 5), ".jpg"),
    ).toBe("Pasted image 20270102030405.jpg");
  });
});

describe("uniqueName", () => {
  it("keeps a free name", () => {
    expect(uniqueName("foto.png", () => false)).toBe("foto.png");
  });

  it("takes the first free numbered name otherwise", () => {
    const used = new Set(["foto.png", "foto 1.png"]);
    expect(uniqueName("foto.png", (name) => used.has(name))).toBe("foto 2.png");
  });

  it("numbers before the extension, and at the end without one", () => {
    expect(uniqueName("nota.md", (name) => name === "nota.md")).toBe("nota 1.md");
    expect(uniqueName("LLEGEIX", (name) => name === "LLEGEIX")).toBe("LLEGEIX 1");
  });
});

describe("nameTakenIn", () => {
  const paths = ["C:\\vault\\docs\\Foto.png", "C:/vault/docs/nota.md"];

  it("finds a file of that name in that folder", () => {
    expect(nameTakenIn("C:/vault/docs", "Foto.png", paths)).toBe(true);
    expect(nameTakenIn("C:\\vault\\docs", "nota.md", paths)).toBe(true);
  });

  it("ignores case, as Windows does", () => {
    expect(nameTakenIn("C:/vault/docs", "foto.PNG", paths)).toBe(true);
    expect(nameTakenIn("c:/VAULT/docs", "NOTA.md", paths)).toBe(true);
  });

  it("is free in another folder or under another name", () => {
    expect(nameTakenIn("C:/vault", "Foto.png", paths)).toBe(false);
    expect(nameTakenIn("C:/vault/docs", "Foto 1.png", paths)).toBe(false);
    expect(nameTakenIn("C:/vault/docs", "Foto.png", [])).toBe(false);
  });

  it("gives uniqueName a name that differs by more than case", () => {
    expect(
      uniqueName("foto.png", (name) => nameTakenIn("C:/vault/docs", name, paths)),
    ).toBe("foto 1.png");
  });
});

describe("toClientPoint", () => {
  it("divides physical pixels by the device pixel ratio", () => {
    expect(toClientPoint({ x: 300, y: 150 }, 1.5)).toEqual({ x: 200, y: 100 });
    expect(toClientPoint({ x: 300, y: 150 }, 1)).toEqual({ x: 300, y: 150 });
    expect(toClientPoint({ x: 300, y: 150 }, 2)).toEqual({ x: 150, y: 75 });
  });

  it("leaves the point alone on a nonsensical scale", () => {
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toClientPoint({ x: 300, y: 150 }, scale)).toEqual({ x: 300, y: 150 });
    }
  });
});

describe("embedTargetFor", () => {
  const folder = "C:/vault";
  const files: FolderFile[] = [
    { name: "Inici.md", path: "C:/vault/Inici.md" },
    { name: "foto.png", path: "C:/vault/foto.png" },
    { name: "Exemple.md", path: "C:/vault/docs/Exemple.md" },
    // A name that exists twice: the shallowest one wins the bare name.
    { name: "Guia.md", path: "C:/vault/Guia.md" },
    { name: "Guia.md", path: "C:/vault/docs/Guia.md" },
    { name: "logo.png", path: "C:/vault/logo.png" },
    { name: "logo.png", path: "C:/vault/docs/img/logo.png" },
  ];

  it("uses the bare note name, without its extension", () => {
    expect(embedTargetFor("C:/vault/Inici.md", folder, files, ".md")).toBe("Inici");
    expect(embedTargetFor("C:/vault/docs/Exemple.md", folder, files, ".md")).toBe(
      "Exemple",
    );
  });

  it("keeps the extension of an image", () => {
    expect(embedTargetFor("C:/vault/foto.png", folder, files, ".md")).toBe("foto.png");
  });

  it("falls back to the path when another file owns the bare name", () => {
    expect(embedTargetFor("C:/vault/Guia.md", folder, files, ".md")).toBe("Guia");
    expect(embedTargetFor("C:/vault/docs/Guia.md", folder, files, ".md")).toBe(
      "docs/Guia",
    );
    expect(embedTargetFor("C:/vault/docs/img/logo.png", folder, files, ".md")).toBe(
      "docs/img/logo.png",
    );
  });

  it("works with Windows separators", () => {
    const winFiles: FolderFile[] = [
      { name: "foto.png", path: "C:\\vault\\docs\\foto.png" },
    ];
    expect(
      embedTargetFor("C:\\vault\\docs\\foto.png", "C:\\vault", winFiles, ".md"),
    ).toBe("foto.png");
  });
});

describe("embedText", () => {
  it("writes one embed per line", () => {
    expect(embedText(["foto.png"])).toBe("![[foto.png]]");
    expect(embedText(["Nota", "docs/Guia"])).toBe("![[Nota]]\n![[docs/Guia]]");
    expect(embedText([])).toBe("");
  });
});
