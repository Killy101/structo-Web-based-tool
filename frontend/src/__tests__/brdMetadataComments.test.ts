import { parseBrdMetadataComments } from "../utils/brdMetadataComments";

describe("parseBrdMetadataComments", () => {
  it("maps Content URI comments onto old-format Content URL fields", () => {
    const comments =
      "Source Name: Ok Source Type: Ok Issuing Agency: Ok Content URI: Please, use the following URL: https://www.b3.com.br/data/files/example.pdf Geography: Ok";

    const result = parseBrdMetadataComments(comments, [
      "Source Name",
      "Source Type",
      "Issuing Agency",
      "Content URL",
      "Geography",
    ]);

    expect(result["issuing agency"]).toBe("Ok");
    expect(result["content url"]).toBe(
      "Please, use the following URL: https://www.b3.com.br/data/files/example.pdf"
    );
    expect(result["geography"]).toBe("Ok");
  });
});
