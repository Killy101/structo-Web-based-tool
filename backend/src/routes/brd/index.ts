// routes/brd/index.ts
import { Router } from "express";
import upload   from "./upload";
import save     from "./save";
import crud     from "./crud";
import sections from "./sections";
import generate from "./generate";

const router = Router();

// Order matters — specific paths before /:brdId catch-all
router.use("/", upload);    // POST /brd/upload
router.use("/", save);      // POST /brd/save
router.use("/", sections);  // GET|PUT /brd/:brdId/sections[/:name]
router.use("/", crud);      // GET /brd, GET /brd/:brdId, DELETE, PATCH
router.use("/", generate);  // POST /brd/:brdId/generate/...

export default router;