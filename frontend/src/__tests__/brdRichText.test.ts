import { brdRichTextToPlain, sanitizeBrdRichTextHtml } from "../utils/brdRichText";

describe("sanitizeBrdRichTextHtml", () => {
  it("preserves links, colors, and combined formatting from BRD source text", () => {
    const input = [
      '<strong><span style="color:#0000ff">SME Checkpoint:</span></strong>',
      '<a href="https://example.com/path">Content URL</a>',
      '<span style="color: rgb(255, 0, 0); font-weight: bold; font-style: italic">Important</span>',
    ].join("<br/>");

    const html = sanitizeBrdRichTextHtml(input);

    expect(html).toContain('<a href="https://example.com/path"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('style="color:#0000ff"');
    expect(html).toContain('color:inherit;text-decoration:underline');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('<strong>');
    expect(html).toContain('Important');
  });

  it("converts plain URLs into clickable links in rendered HTML", () => {
    const html = sanitizeBrdRichTextHtml("See https://example.com/source for details");

    expect(html).toContain('<a href="https://example.com/source"');
    expect(brdRichTextToPlain(html)).toContain("https://example.com/source");
  });

  it("preserves safe file links from BRD source anchors", () => {
    const html = sanitizeBrdRichTextHtml('<a href="file:///C:/confluence/display/~W620263">Raut, Divya</a>');

    expect(html).toContain('href="file:///C:/confluence/display/~W620263"');
    expect(html).toContain('Raut, Divya');
  });
});
