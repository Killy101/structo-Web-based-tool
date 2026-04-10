import { normalizeBrdCitationText } from "../utils/brdCitationText";

describe("normalizeBrdCitationText", () => {
  it("removes unintended single-line breaks in citation text", () => {
    const input =
      'This is the example for this level:\n<Level 2> + "," + <Level 3>\nCrystal-Based on discussion with Paula';

    expect(normalizeBrdCitationText(input)).toBe(
      'This is the example for this level: <Level 2> + "," + <Level 3> Crystal-Based on discussion with Paula'
    );
  });

  it("preserves real paragraph breaks while flattening wrapped lines", () => {
    const input = 'First line wraps\nwithin the paragraph\n\nSecond paragraph stays separate';

    expect(normalizeBrdCitationText(input)).toBe(
      'First line wraps within the paragraph\n\nSecond paragraph stays separate'
    );
  });
});
