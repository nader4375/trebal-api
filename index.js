import "dotenv/config";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

import {
  assertFaceValueAllowed,
  splitLvUv,
  cashOutSplit,
  sponsorshipSplit,
  distributionInternalAllocationFromUv
} from "./core/constitution.js";

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

const allowed = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: function(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowed.length === 0) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    return cb(new Error("CORS_NOT_ALLOWED"));
  }
}));

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

function signToken(user) {
  return jwt.sign({ sub: user.id, roles: user.roles }, JWT_SECRET, { expiresIn: "7d" });
}

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "UNAUTHENTICATED" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    const roles = req.user?.roles || [];
    if (!roles.includes(role)) return res.status(403).json({ error: "FORBIDDEN" });
    next();
  };
}

async function audit(actorId, type, payload) {
  await prisma.auditEvent.create({
    data: {
      actorId: actorId || null,
      type,
      payloadJson: JSON.stringify(payload ?? {})
    }
  });
}

app.get("/healthz", (req, res) => res.json({ ok: true }));

/* Auth */
app.post("/auth/register", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(10),
    role: z.enum(["CUSTOMER", "COLLABORATOR", "SELLER"]).default("CUSTOMER")
  });
  const { email, password, role } = schema.parse(req.body);

  const pepper = process.env.PASSWORD_PEPPER || "";
  const passwordHash = await bcrypt.hash(password + pepper, 12);

  const user = await prisma.user.create({
    data: { email, passwordHash, roles: [role], verified: false }
  });

  await audit(user.id, "USER_REGISTERED", { role });
  const token = signToken(user);
  res.json({ ok: true, token, user: { id: user.id, email: user.email, roles: user.roles, verified: user.verified } });
});

app.post("/auth/login", async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const { email, password } = schema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

  const pepper = process.env.PASSWORD_PEPPER || "";
  const ok = await bcrypt.compare(password + pepper, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" });

  await audit(user.id, "USER_LOGGED_IN", {});
  const token = signToken(user);
  res.json({ ok: true, token });
});

app.get("/me", auth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  res.json({ user: { id: user.id, email: user.email, roles: user.roles, verified: user.verified } });
});

/* NFT purchase (customer) */
app.post("/nft/purchase", auth, requireRole("CUSTOMER"), async (req, res) => {
  const schema = z.object({ faceValue: z.number().int() });
  const { faceValue } = schema.parse(req.body);

  assertFaceValueAllowed(faceValue);
  const { lv, uv } = splitLvUv(faceValue);

  const nft = await prisma.$transaction(async (tx) => {
    const created = await tx.nft.create({
      data: { faceValue, lockedValue: lv, usableValue: uv, state: "GIFT", ownerId: req.user.sub }
    });
    await tx.auditEvent.create({
      data: { actorId: req.user.sub, type: "NFT_PURCHASED", payloadJson: JSON.stringify({ nftId: created.id, faceValue, lv, uv }) }
    });
    return created;
  });

  res.json({ ok: true, nft });
});

/* NFT gift (customer -> collaborator) */
app.post("/nft/gift", auth, requireRole("CUSTOMER"), async (req, res) => {
  const schema = z.object({ nftId: z.string(), collaboratorId: z.string() });
  const { nftId, collaboratorId } = schema.parse(req.body);

  const [nft, collaborator] = await Promise.all([
    prisma.nft.findUnique({ where: { id: nftId } }),
    prisma.user.findUnique({ where: { id: collaboratorId } })
  ]);
  if (!nft) return res.status(404).json({ error: "NFT_NOT_FOUND" });
  if (nft.ownerId !== req.user.sub) return res.status(403).json({ error: "NOT_OWNER" });
  if (!collaborator || !collaborator.roles.includes("COLLABORATOR")) return res.status(400).json({ error: "INVALID_COLLABORATOR" });

  const count = await prisma.nft.count({ where: { ownerId: collaboratorId, state: { not: "RETIRED" } } });
  if (count >= 5) return res.status(409).json({ error: "COLLABORATOR_NFT_CAP_REACHED" });

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.nft.update({
      where: { id: nftId },
      data: { ownerId: collaboratorId, giftedFromId: req.user.sub, state: "GIFT" }
    });
    await tx.auditEvent.create({
      data: { actorId: req.user.sub, type: "NFT_GIFTED", payloadJson: JSON.stringify({ nftId, to: collaboratorId }) }
    });
    return u;
  });

  res.json({ ok: true, nft: updated });
});

/* Collaborator: stack */
app.post("/collab/nft/stack", auth, requireRole("COLLABORATOR"), async (req, res) => {
  const schema = z.object({ nftId: z.string() });
  const { nftId } = schema.parse(req.body);

  const nft = await prisma.nft.findUnique({ where: { id: nftId } });
  if (!nft) return res.status(404).json({ error: "NFT_NOT_FOUND" });
  if (nft.ownerId !== req.user.sub) return res.status(403).json({ error: "NOT_OWNER" });
  if (nft.state === "RETIRED") return res.status(409).json({ error: "NFT_RETIRED" });

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.nft.update({ where: { id: nftId }, data: { state: "STACKED" } });
    await tx.auditEvent.create({ data: { actorId: req.user.sub, type: "NFT_STACKED", payloadJson: JSON.stringify({ nftId }) } });
    return u;
  });

  res.json({ ok: true, nft: updated });
});

/* Collaborator: cash-out */
app.post("/collab/nft/cashout", auth, requireRole("COLLABORATOR"), async (req, res) => {
  const schema = z.object({ nftId: z.string(), batchCount: z.number().int().min(1).max(5) });
  const { nftId, batchCount } = schema.parse(req.body);

  const nft = await prisma.nft.findUnique({ where: { id: nftId } });
  if (!nft) return res.status(404).json({ error: "NFT_NOT_FOUND" });
  if (nft.ownerId !== req.user.sub) return res.status(403).json({ error: "NOT_OWNER" });
  if (nft.state === "RETIRED") return res.status(409).json({ error: "NFT_RETIRED" });

  const { collaboratorPayout, trebalCapture } = cashOutSplit(batchCount, nft.usableValue);

  const retired = await prisma.$transaction(async (tx) => {
    const u = await tx.nft.update({ where: { id: nftId }, data: { state: "RETIRED" } });
    await tx.auditEvent.create({
      data: { actorId: req.user.sub, type: "NFT_CASHED_OUT", payloadJson: JSON.stringify({ nftId, batchCount, collaboratorPayout, trebalCapture }) }
    });
    return u;
  });

  res.json({ ok: true, nft: retired, payout: { collaboratorPayout, trebalCapture } });
});

/* Collaborator: sponsorship convert -> Distribution NFT owned by seller */
app.post("/collab/nft/sponsorship-convert", auth, requireRole("COLLABORATOR"), async (req, res) => {
  const schema = z.object({ nftId: z.string(), sellerId: z.string() });
  const { nftId, sellerId } = schema.parse(req.body);

  const [nft, seller] = await Promise.all([
    prisma.nft.findUnique({ where: { id: nftId } }),
    prisma.user.findUnique({ where: { id: sellerId } })
  ]);
  if (!nft) return res.status(404).json({ error: "NFT_NOT_FOUND" });
  if (!seller || !seller.roles.includes("SELLER")) return res.status(400).json({ error: "INVALID_SELLER" });
  if (nft.ownerId !== req.user.sub) return res.status(403).json({ error: "NOT_OWNER" });
  if (nft.state === "RETIRED") return res.status(409).json({ error: "NFT_RETIRED" });

  const split = sponsorshipSplit(nft.usableValue);
  const allocation = distributionInternalAllocationFromUv(nft.usableValue);

  const converted = await prisma.$transaction(async (tx) => {
    const u = await tx.nft.update({
      where: { id: nftId },
      data: { state: "DISTRIBUTION", ownerId: sellerId, distributionRemainingValue: split.retained }
    });
    await tx.auditEvent.create({
      data: {
        actorId: req.user.sub,
        type: "NFT_SPONSORSHIP_CONVERTED",
        payloadJson: JSON.stringify({
          nftId, sellerId,
          collaboratorPayout: split.collaborator,
          sellerInstantValue: split.seller,
          retained: split.retained,
          platformFeeFromUv: allocation.platformFee,
          discountPoolFromUv: allocation.discountPool
        })
      }
    });
    return u;
  });

  res.json({ ok: true, nft: converted, sponsorship: { ...split, ...allocation } });
});

/* Audit list (admin only) */
app.get("/audit", auth, requireRole("ADMIN"), async (req, res) => {
  const events = await prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  res.json({ events: events.map(e => ({ ...e, payload: JSON.parse(e.payloadJson) })) });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log("Trebal API running on", port));
