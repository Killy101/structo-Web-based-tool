import { Router } from "express";
const router = Router();
router.post("/metadata", async (req, res) => {
  // send file to Python processor, save result to DB via Prisma
  res.json({ success: true });
});
export default router;

