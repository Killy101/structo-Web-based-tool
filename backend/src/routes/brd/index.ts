// routes/brd/index.ts
import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { attachBrdAccessPolicy } from "../../middleware/brd-access";
import upload   from "./upload";
import save     from "./save";
import crud     from "./crud";
import sections from "./sections";
import generate from "./generate";
import images   from "./images";
import versions from "./Versions";

const router = Router();

router.use(authenticate, attachBrdAccessPolicy);

// Order matters — specific paths before /:brdId catch-all
router.use("/", upload);    // POST   /brd/upload
router.use("/", save);      // POST   /brd/save
router.use("/", sections);  // GET|PUT /brd/:brdId/sections[/:name]
router.use("/", images);    // GET    /brd/:brdId/images  +  /brd/:brdId/images/:id/blob
router.use("/", versions);  // GET|POST /brd/:brdId/versions[/:versionNum]
router.use("/", crud);      // GET    /brd, GET /brd/:brdId, DELETE, PATCH
router.use("/", generate);  // POST   /brd/:brdId/generate/...

export default router;