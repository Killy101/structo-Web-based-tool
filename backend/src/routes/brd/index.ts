import { Router } from "express";
import upload from "./upload";
import scope from "./scope";
import metadata from "./metadata";
import toc from "./toc";
import citation from "./citation";
import contentProfile from "./contentProfile";
import generate from "./generate";

const router = Router();

router.use("/", upload);
router.use("/", scope);
router.use("/", metadata);
router.use("/", toc);
router.use("/", citation);
router.use("/", contentProfile);
router.use("/", generate);

export default router;