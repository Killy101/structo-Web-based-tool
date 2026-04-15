import { authorize } from "../middleware/authorize";

describe("SADMIN access alias", () => {
  it("treats SADMIN as a super admin for protected routes", () => {
    const middleware = authorize(["SUPER_ADMIN"]);
    const req = { user: { role: "SADMIN" } } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any;
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
